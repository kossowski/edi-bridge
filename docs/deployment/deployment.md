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

| Application | Patterns                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| web         | `apps/web/**`, `packages/ui/**`, `packages/contracts/**`, `packages/mocks/**`                                                     |
| api         | `apps/api/**`, `packages/contracts/**`, `packages/db/**`, `packages/edifact/**`, `packages/mapping/**`                            |
| worker      | `apps/worker/**`, `packages/pipeline/**`, `packages/db/**`, `packages/contracts/**`, `packages/edifact/**`, `packages/mapping/**` |

All three applications also watch these shared build inputs:

```text
packages/typescript-config/**
packages/oxlint-config/**
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

| Application | Variable                       | Value template                                                                 |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------ |
| web         | `NODE_ENV`                     | `production`                                                                   |
| web         | `HOSTNAME`                     | `0.0.0.0`                                                                      |
| web         | `PORT`                         | `3000`                                                                         |
| api         | `NODE_ENV`                     | `production`                                                                   |
| api         | `API_PORT`                     | `3001`                                                                         |
| api, worker | `DATABASE_URL`                 | `postgres://edi_bridge:<postgres-password>@<postgres-service>:5432/edi_bridge` |
| api         | `WEB_ORIGIN`                   | Not set; see below                                                             |
| api         | `BETTER_AUTH_URL`              | `https://edi-bridge.example.com`                                               |
| api         | `BETTER_AUTH_SECRET`           | `<auth-secret>`                                                                |
| api         | `CHANNEL_SECRET_KEY`           | `<channel-secret-key>`                                                         |
| api         | `API_PUBLIC_URL`               | Not set; see below                                                             |
| api, worker | `REDIS_URL`                    | `redis://:<redis-password>@<redis-service>:6379`                               |
| worker      | `NODE_ENV`                     | `production`                                                                   |
| worker      | `WORKER_HEALTH_PORT`           | `3002`                                                                         |
| worker      | `RUN_REQUEUE_INTERVAL_SECONDS` | Not set; see below                                                             |

These runtime variables require neither Docker build arguments nor a repository `.env` file.

`BETTER_AUTH_URL` is the public origin of the installation, without the `/api` prefix. The API rejects sign-in requests from other origins and sets secure session cookies when the origin uses HTTPS. `<auth-secret>` is a random value of at least 32 characters, stored in Dokploy, that signs the session cookies. Generate it once, for example with `openssl rand -base64 32`. Changing it signs out every user. The API does not start in production without both variables.

`WEB_ORIGIN` is the web origin that the API allows for cross-origin (CORS) requests and trusts for sign-in. In development, its default is `http://localhost:3000`. In production, it has no default, and the API trusts only the origin of `BETTER_AUTH_URL`. This deployment does not need it, because web and API share one origin through the `/api` prefix.

`<channel-secret-key>` is the key that encrypts the Channel secrets in Postgres: SFTP credentials, webhook tokens and HTTP Authorization headers. It is 32 random bytes, base64-encoded and stored in Dokploy. Generate it once, for example with `openssl rand -base64 32`. The API does not start in production without it. Keep the key: the API cannot decrypt the stored Channel secrets with another key.

`RUN_REQUEUE_INTERVAL_SECONDS` is how often the worker queues again the Runs that are still received, for example because Redis was unreachable when they arrived. The worker also does this when it starts. Its default is `60`.

`API_PUBLIC_URL` is the public URL of the API, which the API puts into the webhook URL of each webhook Channel. In production, its default is the `/api` path of `BETTER_AUTH_URL`, for example `https://edi-bridge.example.com/api`. In development, its default is `BETTER_AUTH_URL`. Set it only if the API is served from a different path or origin.

## API URL of the web application

The browser calls the API through the same-origin `/api` prefix. Next.js inlines `NEXT_PUBLIC_API_URL` into the client bundle at build time, so the variable has no effect at runtime. The web Dockerfile sets the build argument `NEXT_PUBLIC_API_URL` to `/api` by default. For example, the browser requests `/api/workspaces/current`, and Traefik forwards it to `/workspaces/current` on the API.

The Dokploy web application requires no build argument. Override `NEXT_PUBLIC_API_URL` only if the API is served from a different path or origin. Outside Docker, the variable defaults to `http://localhost:3001`.

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
