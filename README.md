# edi-bridge

⚠️ EDI Bridge is under active development. The current implementation is a deployment skeleton and is not ready for production use. APIs and data formats may change.

A Turborepo monorepo with three apps, a contributor CLI and shared packages:

| Path                         | What it is                               |
| ---------------------------- | ---------------------------------------- |
| `apps/web`                   | Next.js dashboard                        |
| `apps/api`                   | Fastify HTTP API                         |
| `apps/worker`                | Background worker                        |
| `apps/cli`                   | Contributor CLI                          |
| `packages/ui`                | Shared shadcn/ui components              |
| `packages/fixtures`          | Fixture Documents to submit to a Channel |
| `packages/oxlint-config`     | Shared Oxlint configs                    |
| `packages/typescript-config` | Shared TypeScript configs                |

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

Before the api starts, `pnpm dev` seeds a development Workspace and its Operator. Sign in as `operator@edi-bridge.example` with the password `edi-bridge-operator`. The production image never runs this seed; see [Create the Operator](docs/deployment/deployment-operations.md#create-the-operator) for a deployment.

The host ports of the infrastructure services can be changed in `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `SFTP_PORT`). Compose binds all published ports to `127.0.0.1`. The bundled credentials are for local development only.

Stop the infrastructure with `docker compose down`; add `-v` to also delete its data.

## Submit a Document from the command line

The `cli` script submits a Document file to an inbound Channel of the running API, for example of `pnpm dev`:

```sh
pnpm cli submit --channel "<inbound Channel name>" [--encoding <encoding>] <file>
```

The command signs in, looks up the Channel by its name and sends the file as a Manual Submission, so the pipeline processes it exactly like a Manual Submission from web, and its Runs are marked as manual. It prints one line per Run and one per Message Type that no Flow on the Channel routes. It exits with a non-zero code when the encoding is unknown, the Channel is unknown or outbound, the sign-in fails or the API rejects the Document.

`--encoding` names the character encoding of the file: `utf-8` (the default), `iso-8859-1` or `windows-1252`. The command sends the bytes of the file with that encoding, and the API decodes them: an Interchange in the character set its UNB syntax identifier names, any other Document in the named encoding. The API refuses a file that is not valid in its encoding, so a damaged Document is never stored. The fixture Documents of `packages/fixtures` need these encodings:

| Fixture          | Encoding       |
| ---------------- | -------------- |
| `orders-*.edi`   | `iso-8859-1`   |
| `invoice-*.json` | `utf-8`        |
| `dispatch-*.csv` | `windows-1252` |

For example:

```sh
pnpm cli submit --channel "ERP webhook" --encoding windows-1252 packages/fixtures/documents/valid/dispatch-nordlicht-markt.csv
```

The [fixture library README](packages/fixtures/README.md) says which Channel and Flow each fixture needs.

The command reads these variables from the environment or from `.env`:

| Variable              | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| `EDI_BRIDGE_API_URL`  | The API URL (default `http://localhost:3001`)                             |
| `EDI_BRIDGE_EMAIL`    | The email of the user who submits                                         |
| `EDI_BRIDGE_PASSWORD` | The password of that user                                                 |
| `EDI_BRIDGE_ORIGIN`   | The origin the API trusts for sign-in (default the origin of the API URL) |

`.env.example` sets the development Operator. The Channel must belong to the user's Workspace and have a Flow, so create both in web first.

## Mock mode

In mock mode, web runs without the API. MSW intercepts requests to the real API URLs in the browser and answers them with the handlers from `packages/mocks`:

```sh
pnpm dev:mock
```

Without mock mode, web calls the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). The web Docker image sets it to `/api` instead, the same-origin API path of the deployment. Both variables are read at build time, so restart `next dev` or rebuild after you change them.

The API allows cross-origin requests from `WEB_ORIGIN` and trusts it for sign-in (default `http://localhost:3000` in development, none in production). Set it in `.env` when web runs on another origin. Same-origin requests through `/api` do not need it.

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
pnpm test:stories
pnpm test:e2e
pnpm build
```

`pnpm test:stories` runs every story as a test in Chromium, with accessibility checks. `pnpm test:e2e` runs Playwright against web in mock mode. Both need the Playwright browser once:

```sh
pnpm --filter @edi-bridge/web exec playwright install chromium
```

Tests never depend on the local Compose services.

`pnpm check:fast` runs lint, type check, the tests and the stories. `pnpm check` adds the canvas stories, the e2e tests, the builds and Storybook. Both run one task at a time to stay within the memory of a small machine; `concurrency` in `turbo.json` sets this limit. The dev, watch and Storybook scripts run their persistent tasks side by side, so they raise the limit with `--concurrency=10`.

## Full stack in Docker

Each app has its own Dockerfile, built from the repository root. The `full-stack` Compose profile runs the infrastructure plus the production images of all three apps:

```sh
docker compose --profile full-stack up -d --build --wait
```

`--wait` returns once every health check passes. The apps listen on the same ports as in local development (`WEB_PORT`, `API_PORT` and `WORKER_HEALTH_PORT` change the host ports), so stop `pnpm dev` first. Stop the stack with `docker compose --profile full-stack down`.

No reverse proxy runs in the profile, so the browser calls the API directly on its host port. Compose builds the web image with `NEXT_PUBLIC_API_URL` set to `http://localhost:<API_PORT>`, and the API trusts `http://localhost:<WEB_PORT>` as the web origin. Next.js inlines `NEXT_PUBLIC_API_URL` at build time, so rebuild the web image (`--build`) after you change `API_PORT`.

The stack runs the production images, so it has no development seed and no user. Create the Operator once in the running api container, and enter the password at the prompt:

```sh
docker compose exec api node dist/create-operator.js --email <operator-email> --name "<operator-name>" --workspace "<workspace-name>"
```

To create the Operator without a prompt, for example in a script, pass the password in `OPERATOR_PASSWORD` for this one command:

```sh
docker compose --profile full-stack exec -T -e OPERATOR_PASSWORD='<password>' api node dist/create-operator.js --email <operator-email> --name "<operator-name>" --workspace "<workspace-name>"
```

Then sign in at `http://localhost:3000` (or your `WEB_PORT`) with the email and password.

See [Create the Operator](docs/deployment/deployment-operations.md#create-the-operator) for the options.

To create the Showcase and Sandbox Workspaces, and later to reset the Sandbox to its seed:

```sh
docker compose exec api node dist/create-demo-workspaces.js
docker compose exec api node dist/reset-sandbox.js
```

See [Create the Showcase and Sandbox](docs/deployment/deployment-operations.md#create-the-showcase-and-sandbox) and [Reset the Sandbox](docs/deployment/deployment-operations.md#reset-the-sandbox).

A Playwright test runs against the started stack. It signs in as the Operator, sets up an invoice Flow to the profile's SFTP service through the API, submits an invoice manually in the UI and waits until the Run is delivered. Pass the Operator's credentials, and `WEB_PORT` and `API_PORT` if you changed them:

```sh
OPERATOR_EMAIL=<operator-email> OPERATOR_PASSWORD='<password>' pnpm --filter @edi-bridge/web test:e2e:full-stack
```

Each run creates its own Channels, Mapping and Flow, so the test runs again against the same stack. `test:e2e` keeps running only the mock-mode tests.

A single image builds with:

```sh
docker build -f apps/api/Dockerfile .
```

## CI

GitHub Actions runs lint, check-types, test (one package at a time, so each Vitest run gets the whole runner), the stories, the canvas stories in three shards, the Playwright tests, build and the Storybook build on every pull request. Turborepo's `--affected` flag limits the run to the packages changed on the branch and the packages that depend on them. A job whose tasks are all unaffected is skipped before it installs dependencies.

The full-stack E2E test runs in a job of its own: it builds and starts the `full-stack` profile, creates the Operator and runs `test:e2e:full-stack`. It runs on every push to `main` and on every pull request that changes code, dependencies, the Compose file or the workflows. On failure, the job uploads the Playwright traces and prints the Compose logs.

## Deployment

See [Dokploy deployment configuration](docs/deployment/deployment.md) and [Deploy and maintain EDI Bridge](docs/deployment/deployment-operations.md) for service configuration, routing, and verification.

Installation-specific notes belong in the Git-ignored `.local/deployment/` directory. They are available only on machines where you provision them. See [Private deployment notes](docs/deployment/private-notes.md) for storage and backup options.

## License

EDI Bridge uses the [MIT license](LICENSE). Copied code and skills retain the licenses listed in [Third-party notices](THIRD_PARTY_NOTICES.md).
