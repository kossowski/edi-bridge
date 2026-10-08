# Dokploy deployment

The walking skeleton runs in the existing **EDI Bridge → production** environment on the Dokploy VPS. Web, API and worker are separate applications connected to `kossowski/edi-bridge` through the existing Dokploy GitHub app. Each watches pushes to `main`, with automatic deployment enabled and no path filters.

| Service  | Build configuration                                   | Internal address                  |
| -------- | ----------------------------------------------------- | --------------------------------- |
| web      | `apps/web/Dockerfile`, context `.`, build path `/`    | `edi-bridge-web-oevxpz:3000`      |
| api      | `apps/api/Dockerfile`, context `.`, build path `/`    | `edi-bridge-api-jhn41d:3001`      |
| worker   | `apps/worker/Dockerfile`, context `.`, build path `/` | `edi-bridge-worker-85o7oj:3002`   |
| Postgres | `postgres:18.6-alpine3.24`                            | `edi-bridge-postgres-aklywo:5432` |
| Redis    | `redis:8.10.2-alpine3.23`                             | `edi-bridge-redis-5pxkni:6379`    |

The database is `edi_bridge`, owned by `edi_bridge`. Dokploy manages persistent volumes for Postgres and Redis. Neither database has an external port. The worker health server is internal. The local `compose.yaml` is a development setup; production uses Dokploy's individual services and generated credentials.

## Routing

- Web: <https://edi-bridge.kossowski.io/>
- API health: <https://edi-bridge.kossowski.io/api/health>
- Worker health: `http://edi-bridge-worker-85o7oj:3002/health` on the Dokploy network.

The proxied Cloudflare CNAME points to `f15c7e4a-0ac8-4889-9001-8251d0e24d3f.cfargotunnel.com` (`dokploy-tunnel`, the connector in the **Web** project). Its hostname rule forwards to `http://dokploy-traefik:80`. Traefik routes `/` to web on port 3000 and `/api` to API on port 3001, stripping `/api` before forwarding. HTTPS terminates at Cloudflare; the Dokploy domain entries use HTTP with certificate type `none`, matching the existing tunnel setup.

Reuse this tunnel for applications on this VPS. [Cloudflare supports multiple hostname routes per tunnel](https://developers.cloudflare.com/tunnel/). A separate tunnel is useful for independent credentials, network access or lifecycle requirements. The other existing tunnel, `kossowski-io`, remains unchanged; the two existing connectors are separate tunnels, not replicas.

## Environment variables

Set these in each application's Dokploy **Environment** settings. Database passwords are generated independently and stored in Dokploy, never in the repository. Replace the placeholders below with the corresponding Dokploy database password; URL-encode a password if it contains URL-special characters. The initial generated passwords use hexadecimal characters.

| Application | Variable             | Production value                                                                       |
| ----------- | -------------------- | -------------------------------------------------------------------------------------- |
| web         | `NODE_ENV`           | `production`                                                                           |
| web         | `HOSTNAME`           | `0.0.0.0`                                                                              |
| web         | `PORT`               | `3000`                                                                                 |
| api         | `NODE_ENV`           | `production`                                                                           |
| api         | `API_PORT`           | `3001`                                                                                 |
| api         | `DATABASE_URL`       | `postgres://edi_bridge:<postgres-password>@edi-bridge-postgres-aklywo:5432/edi_bridge` |
| api, worker | `REDIS_URL`          | `redis://:<redis-password>@edi-bridge-redis-5pxkni:6379`                               |
| worker      | `NODE_ENV`           | `production`                                                                           |
| worker      | `WORKER_HEALTH_PORT` | `3002`                                                                                 |

The web skeleton does not yet call the API and needs no API URL variable. Browser API calls can use the same-origin `/api` prefix. Runtime variables do not need to be passed as Docker build arguments or written to a repository `.env` file.

## Verification and operations

After a push to `main`, check all three applications' deployment history in Dokploy for the pushed commit and a successful build. A successful build alone does not prove that dependencies are reachable:

```sh
curl -fsS https://edi-bridge.kossowski.io/ > /dev/null
curl -fsS https://edi-bridge.kossowski.io/api/health
```

The API must return `{"status":"healthy","checks":{"postgres":"up","redis":"up"}}`. The worker's Dockerfile health check requests `/health` and requires Redis to respond; inspect its runtime logs and container health in Dokploy. All three Dockerfiles include health checks.

The first deployment builds images on the VPS, one application at a time. If future builds fail with an out-of-memory error or exit 137, record the affected deployment and switch to CI-built images rather than repeatedly exhausting the VPS. Memory monitoring is not currently returning metrics through Dokploy, so successful build logs establish completion but do not quantify peak memory usage.

To redeploy without a Git change, use the application's Deploy action in Dokploy. Keep database credentials synchronized with the application's connection URLs when rotating passwords, then redeploy API and worker. Redeploying apps preserves database volumes.
