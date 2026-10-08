# edi-bridge

⚠️ EDI Bridge is under active development. The current implementation is a deployment skeleton and is not ready for production use. APIs and data formats may change.

A Turborepo monorepo with three apps and shared packages:

| Path                         | What it is                  |
| ---------------------------- | --------------------------- |
| `apps/web`                   | Next.js dashboard           |
| `apps/api`                   | Fastify HTTP API            |
| `apps/worker`                | Background worker           |
| `packages/ui`                | Shared shadcn/ui components |
| `packages/eslint-config`     | Shared ESLint configs       |
| `packages/oxlint-config`     | Shared Oxlint configs       |
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

The host ports of the infrastructure services can be changed in `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `SFTP_PORT`). Compose binds all published ports to `127.0.0.1`. The bundled credentials are for local development only.

Stop the infrastructure with `docker compose down`; add `-v` to also delete its data.

## Mock mode

In mock mode, web runs without the API. MSW intercepts requests to the real API URLs in the browser and answers them with the handlers from `packages/mocks`:

```sh
pnpm dev:mock
```

Without mock mode, web calls the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). The web Docker image sets it to `/api` instead, the same-origin API path of the deployment. Both variables are read at build time, so restart `next dev` or rebuild after you change them.

## Storybook

Storybook lives in `apps/web` and also shows the stories of `packages/ui`. It uses the same MSW handlers as mock mode:

```sh
pnpm storybook
```

Storybook opens at http://localhost:6006. Each push to `main` publishes it to GitHub Pages.

## Checks

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm test:e2e
pnpm build
```

`pnpm test` also runs every story as a test in Chromium, with accessibility checks. `pnpm test:e2e` runs Playwright against web in mock mode. Both need the Playwright browser once:

```sh
pnpm --filter @edi-bridge/web exec playwright install chromium
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

GitHub Actions runs lint, check-types, test, the Playwright tests, build and the Storybook build on every pull request. Turborepo's `--affected` flag limits the run to the packages changed on the branch and the packages that depend on them.

## Deployment

See [Dokploy deployment configuration](docs/deployment/deployment.md) and [Deploy and maintain EDI Bridge](docs/deployment/deployment-operations.md) for service configuration, routing, and verification.

Installation-specific notes belong in the Git-ignored `.local/deployment/` directory. They are available only on machines where you provision them. See [Private deployment notes](docs/deployment/private-notes.md) for storage and backup options.

## License

EDI Bridge uses the [MIT license](LICENSE). Copied code and skills retain the licenses listed in [Third-party notices](THIRD_PARTY_NOTICES.md).
