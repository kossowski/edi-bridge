# Dokploy deployment configuration

This reference describes the deployment layout for the EDI Bridge skeleton on Dokploy. The web, API, and worker applications connect to the repository through the Dokploy GitHub app. Each application deploys automatically when a push to `main` matches its **Watch Paths**.

Service names and hostnames below are placeholders. Actual installation details belong in `.local/deployment/`, which is ignored by Git. See [Private deployment notes](private-notes.md) for storage options and [Deploy and maintain EDI Bridge](deployment-operations.md) for operating steps.

## Services

| Service  | Build configuration                                   | Internal address          |
| -------- | ----------------------------------------------------- | ------------------------- |
| web      | `apps/web/Dockerfile`, context `.`, build path `/`    | `<web-service>:3000`      |
| api      | `apps/api/Dockerfile`, context `.`, build path `/`    | `<api-service>:3001`      |
| worker   | `apps/worker/Dockerfile`, context `.`, build path `/` | `<worker-service>:3002`   |
| Postgres | `postgres:18.6-alpine3.24`                            | `<postgres-service>:5432` |
| Redis    | `redis:8.10.2-alpine3.23`                             | `<redis-service>:6379`    |

The Postgres database and its owner are both named `edi_bridge`. Dokploy manages persistent volumes for Postgres and Redis. Neither service exposes an external port. The worker health server is accessible only on the Dokploy network.

The local [`compose.yaml`](../../compose.yaml) defines the development setup. Production uses separate Dokploy services and generated credentials.

## Deployment triggers

Dokploy's GitHub settings contain these application-specific patterns:

| Application | Patterns                        |
| ----------- | ------------------------------- |
| web         | `apps/web/**`, `packages/ui/**` |
| api         | `apps/api/**`                   |
| worker      | `apps/worker/**`                |

All three applications also watch these shared build inputs:

```text
packages/typescript-config/**
packages/eslint-config/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
.dockerignore
```

Documentation-only changes do not trigger deployment. A change to `pnpm-lock.yaml` deploys every application. **Watch Paths** are static filters. Each application's directory pattern includes its Dockerfile.

## Routing

The endpoint templates are:

- Web: [EDI Bridge](https://edi-bridge.example.com/).
- API health: [API health endpoint](https://edi-bridge.example.com/api/health).
- Worker health: `http://<worker-service>:3002/health` on the Dokploy network.

The proxied Cloudflare CNAME points to `<tunnel-id>.cfargotunnel.com`. The tunnel hostname rule forwards requests to the Dokploy Traefik service at `http://<traefik-service>:80`. Tunnel identifiers, connector names, and Cloudflare project names belong in the private installation notes.

Traefik routes `/` to web on port 3000. It routes `/api` to API on port 3001 and removes the `/api` prefix before forwarding requests. HTTPS terminates at Cloudflare. The Dokploy domain entries use HTTP with certificate type `none`.

## Environment variables

Each application's Dokploy **Environment** settings contain values with the forms below. Dokploy stores separate generated passwords for Postgres and Redis. The repository contains no production passwords.

`<postgres-password>` and `<redis-password>` represent the corresponding passwords stored in Dokploy. Passwords in connection URLs require URL encoding if they contain characters with a special meaning in URLs.

| Application | Variable             | Value template                                                                 |
| ----------- | -------------------- | ------------------------------------------------------------------------------ |
| web         | `NODE_ENV`           | `production`                                                                   |
| web         | `HOSTNAME`           | `0.0.0.0`                                                                      |
| web         | `PORT`               | `3000`                                                                         |
| api         | `NODE_ENV`           | `production`                                                                   |
| api         | `API_PORT`           | `3001`                                                                         |
| api         | `DATABASE_URL`       | `postgres://edi_bridge:<postgres-password>@<postgres-service>:5432/edi_bridge` |
| api, worker | `REDIS_URL`          | `redis://:<redis-password>@<redis-service>:6379`                               |
| worker      | `NODE_ENV`           | `production`                                                                   |
| worker      | `WORKER_HEALTH_PORT` | `3002`                                                                         |

The web application does not call the API and requires no API URL variable. The `/api` prefix routes browser requests to the API on the same origin. These runtime variables require neither Docker build arguments nor a repository `.env` file.

## Health checks

Each application Dockerfile defines a health check. The web check requests `/`. The API and worker checks request `/health`.

The API returns HTTP 200 only when both Postgres and Redis respond. Its healthy response is:

```json
{ "status": "healthy", "checks": { "postgres": "up", "redis": "up" } }
```

The worker returns HTTP 200 only when Redis responds. Its healthy response is:

```json
{ "status": "healthy", "checks": { "redis": "up" } }
```

If a dependency check fails, the API or worker returns HTTP 503 with `status` set to `unhealthy`. The failed dependency's check is `down`.
