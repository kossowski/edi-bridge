# edi-bridge

A Turborepo monorepo with three apps and shared packages:

| Path                         | What it is                  |
| ---------------------------- | --------------------------- |
| `apps/web`                   | Next.js dashboard           |
| `apps/api`                   | Fastify HTTP API            |
| `apps/worker`                | Background worker           |
| `packages/ui`                | Shared shadcn/ui components |
| `packages/eslint-config`     | Shared ESLint configs       |
| `packages/typescript-config` | Shared TypeScript configs   |

## Local setup

Infrastructure (Postgres, Redis and an SFTP server) runs in Docker; the apps run natively for fast reloads and simple debugging.

Prerequisites: Node.js 24.21 or later (below 25), pnpm 12.8 or later (below 13) and Docker with Compose.

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

`docker compose up` starts the infrastructure only. `pnpm dev` then starts all three apps through Turborepo:

| App    | URL                          |
| ------ | ---------------------------- |
| web    | http://localhost:3000        |
| api    | http://localhost:3001/health |
| worker | http://localhost:3002/health |

The host ports of the infrastructure services can be changed in `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `SFTP_PORT`).

Stop the infrastructure with `docker compose down`; add `-v` to also delete its data.

## Checks

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Tests never depend on the local Compose services.

## Full stack in Docker

Each app has its own Dockerfile, built from the repository root. The `full-stack` Compose profile runs the infrastructure plus the production images of all three apps:

```sh
docker compose --profile full-stack up -d --build --wait
```

`--wait` returns once every health check passes. The apps listen on the same ports as in local development (`WEB_PORT`, `API_PORT` and `WORKER_HEALTH_PORT` change the host ports), so stop `pnpm dev` first. Stop the stack with `docker compose --profile full-stack down`.

A single image builds with:

```sh
docker build -f apps/api/Dockerfile .
```

## CI

GitHub Actions runs lint, check-types, test and build on every pull request. Turborepo's `--affected` flag limits the run to the packages changed on the branch and the packages that depend on them.
