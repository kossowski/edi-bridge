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

| Application | Patterns                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web         | `apps/web/**`, `packages/ui/**`, `packages/contracts/**`, `packages/mocks/**`                                                                             |
| api         | `apps/api/**`, `packages/channels/**`, `packages/pipeline/**`, `packages/contracts/**`, `packages/db/**`, `packages/edifact/**`, `packages/mapping/**`    |
| worker      | `apps/worker/**`, `packages/channels/**`, `packages/pipeline/**`, `packages/contracts/**`, `packages/db/**`, `packages/edifact/**`, `packages/mapping/**` |

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

### Live events

The browser receives live events from `/api/events` as server-sent events, a response that stays open. The proxies need no setting for it by default:

- The API sends a heartbeat comment every 25 seconds, within the 100-second idle limit of Cloudflare.
- The API sends `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, so proxies forward each event at once.

Do not add a buffering or compression middleware to the Traefik router of the API. Such a middleware holds the events back until the response ends.

## Environment variables

Each application's Dokploy **Environment** settings contain values with the forms below. Dokploy stores separate generated passwords for Postgres and Redis. The repository contains no production passwords.

`<postgres-password>` and `<redis-password>` represent the corresponding passwords stored in Dokploy. Passwords in connection URLs require URL encoding if they contain characters with a special meaning in URLs.

| Application | Variable                       | Value template                                                                               |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| web         | `NODE_ENV`                     | `production`                                                                                 |
| web         | `HOSTNAME`                     | `0.0.0.0`                                                                                    |
| web         | `PORT`                         | `3000`                                                                                       |
| api         | `NODE_ENV`                     | `production`                                                                                 |
| api         | `API_PORT`                     | `3001`                                                                                       |
| api, worker | `DATABASE_URL`                 | `postgres://edi_bridge:<postgres-password>@<postgres-service>:5432/edi_bridge`               |
| api         | `WEB_ORIGIN`                   | Not set; see below                                                                           |
| api         | `BETTER_AUTH_URL`              | `https://edi-bridge.example.com`                                                             |
| api         | `BETTER_AUTH_SECRET`           | `<auth-secret>`                                                                              |
| api, worker | `CHANNEL_SECRET_KEY`           | `<channel-secret-key>`                                                                       |
| api         | `API_PUBLIC_URL`               | Not set; see below                                                                           |
| api         | `ANTHROPIC_API_KEY`            | `<anthropic-api-key>`                                                                        |
| api         | `AI_MODEL`                     | Not set; see below                                                                           |
| api         | `SENTRY_DSN`                   | `<api-sentry-dsn>`; see [Error monitoring of the API](#error-monitoring-of-the-api)          |
| api         | `SENTRY_ENVIRONMENT`           | `production`                                                                                 |
| api         | `SENTRY_TRACES_SAMPLE_RATE`    | Not set; see [Error monitoring of the API](#error-monitoring-of-the-api)                     |
| api, worker | `REDIS_URL`                    | `redis://:<redis-password>@<redis-service>:6379`                                             |
| worker      | `NODE_ENV`                     | `production`                                                                                 |
| worker      | `WORKER_HEALTH_PORT`           | `3002`                                                                                       |
| worker      | `RUN_REQUEUE_INTERVAL_SECONDS` | Not set; see below                                                                           |
| worker      | `RUN_STUCK_AFTER_MINUTES`      | Not set; see below                                                                           |
| worker      | `SENTRY_DSN`                   | `<worker-sentry-dsn>`; see [Error monitoring of the worker](#error-monitoring-of-the-worker) |
| worker      | `SENTRY_ENVIRONMENT`           | `production`                                                                                 |
| worker      | `SENTRY_TRACES_SAMPLE_RATE`    | Not set; see [Error monitoring of the worker](#error-monitoring-of-the-worker)               |

These runtime variables require neither Docker build arguments nor a repository `.env` file.

`BETTER_AUTH_URL` is the public origin of the installation, without the `/api` prefix. The API rejects sign-in requests from other origins and sets secure session cookies when the origin uses HTTPS. `<auth-secret>` is a random value of at least 32 characters, stored in Dokploy, that signs the session cookies. Generate it once, for example with `openssl rand -base64 32`. Changing it signs out every user. The API does not start in production without both variables.

`WEB_ORIGIN` is the web origin that the API allows for cross-origin (CORS) requests and trusts for sign-in. In development, its default is `http://localhost:3000`. In production, it has no default, and the API trusts only the origin of `BETTER_AUTH_URL`. This deployment does not need it, because web and API share one origin through the `/api` prefix.

`<channel-secret-key>` is the key that encrypts the Channel secrets in Postgres: SFTP credentials, webhook tokens and HTTP Authorization headers. It is 32 random bytes, base64-encoded and stored in Dokploy. Generate it once, for example with `openssl rand -base64 32`. The API and the worker use the same key: the API encrypts the secrets, and the worker decrypts the SFTP credential when it delivers a Run. Neither starts in production without it. Keep the key: the stored Channel secrets cannot be decrypted with another key.

`RUN_REQUEUE_INTERVAL_SECONDS` is how often the worker queues again the Runs that are still received, for example because Redis was unreachable when they arrived. The worker also does this when it starts. The same interval paces the check for stuck Runs, the Overdue check and the sending of CONTRLs. The worker answers each received Interchange with a CONTRL. The Overdue check marks a sent Interchange Overdue when its Acknowledgement does not arrive within the time limit of its Trading Partner. Its default is `60`.

`RUN_STUCK_AFTER_MINUTES` is how long a Run can stay processing without a change before the worker treats it as stuck, for example because a worker stopped during the Run. Set it higher than the longest step takes, because the worker fails a Run whose step runs longer. At each interval of `RUN_REQUEUE_INTERVAL_SECONDS`, the worker queues a stuck Run again if none of its steps after the receipt started. It fails every other stuck Run as a Defect at the step that was running or next to run, so the Run can be tried again. A Run that was already handed over fails at delivery, and its Retry does not hand it over a second time. The worker also tries a CONTRL again when its delivery failed or was cut off at least `RUN_STUCK_AFTER_MINUTES` ago. Its default is `10`.

`API_PUBLIC_URL` is the public URL of the API, which the API puts into the webhook URL of each webhook Channel. In production, its default is the `/api` path of `BETTER_AUTH_URL`, for example `https://edi-bridge.example.com/api`. In development, its default is `BETTER_AUTH_URL`. Set it only if the API is served from a different path or origin.

`<anthropic-api-key>` is the Anthropic API key with which the API requests AI drafts of Mappings. It is stored in Dokploy. Without it, the API starts, but every AI draft fails as unavailable. The API does not start with a key that contains whitespace.

`AI_MODEL` is the Anthropic model that drafts the Mappings. Its default is `claude-sonnet-5-5`. Set it only to draft with another model.

## Error monitoring of the worker

The worker reports Defects and uncaught errors to Sentry, and sends a sample of its traces. Sentry is optional: without `SENTRY_DSN`, the worker starts and sends nothing.

The API and the worker each read `SENTRY_DSN` from the environment of their own Dokploy service. Use one Sentry project for each application, so the events of each application stay apart.

`<worker-sentry-dsn>` is the DSN of the Sentry project of the worker, stored in Dokploy. `SENTRY_ENVIRONMENT` is the environment that Sentry files the events under, for example `production` or `staging`. `SENTRY_TRACES_SAMPLE_RATE` is the share of Runs whose traces the worker sends, from `0` to `1`. Its default is `0.1`. A Run whose receipt was traced continues the trace of its receipt, and a Run whose receipt was not traced sends no trace. A Run queued without the trace of a receipt, for example by the sweep, a Retry or a Reprocess, is sampled anew at this rate.

A Defect event carries the failure code, the Workspace, Run, Trading Partner and Channel ids as tags, and the stack frames of the Defect. It carries no Document contents, Channel secrets or error messages. An uncaught error arrives with the stack frames and the type of the error and its causes, without their error messages. A Run that fails at parse, validation or setup, or an inbound Channel that fails to poll, sends no event. A failed Run job is not reported a second time: the processing of the Run reports its Defect.

## Error monitoring of the API

`<api-sentry-dsn>` is the DSN of the Sentry project of the API, stored in Dokploy. Without it, the API sends nothing to Sentry. With it, the API reports unexpected errors, the requests that fail with HTTP 5xx, but no rejected request with HTTP 4xx. The API sends traces of its requests. The trace of a webhook request or a Manual Submission continues in the worker that processes its Runs. Reports and traces leave out request bodies, headers, cookies, query strings, error messages, the file paths and addresses of system errors, logs and database and Redis traffic, because they can contain Documents, file names of Trading Partners, Channel secrets or tokens. `SENTRY_ENVIRONMENT` is the environment that Sentry files the events under, for example `production` or `staging`. `SENTRY_TRACES_SAMPLE_RATE` is the share of requests that the API traces, from `0` to `1`. Its default is `0.1`.

## API URL of the web application

The browser calls the API through the same-origin `/api` prefix. Next.js inlines `NEXT_PUBLIC_API_URL` into the client bundle at build time, so the variable has no effect at runtime. The web Dockerfile sets the build argument `NEXT_PUBLIC_API_URL` to `/api` by default. For example, the browser requests `/api/workspaces/current`, and Traefik forwards it to `/workspaces/current` on the API.

The Dokploy web application requires no build argument. Override `NEXT_PUBLIC_API_URL` only if the API is served from a different path or origin. Outside Docker, the variable defaults to `http://localhost:3001`.

## Error monitoring of the web application

The web application reports unexpected errors to Sentry: errors in the browser, and errors of the server when it renders a page. It sends a sample of the page loads and navigations as traces. Sentry is optional: without a DSN, the web application sends nothing. This also applies to local development, mock mode, Storybook and Playwright.

The browser and the server read separate variables. Next.js inlines the `NEXT_PUBLIC_` variables into the client bundle at build time, so set them as build arguments of the Dokploy web application. Set the server variables in its **Environment** settings.

| Kind           | Variable                                | Value template                   |
| -------------- | --------------------------------------- | -------------------------------- |
| Runtime        | `SENTRY_DSN`                            | `<web-sentry-dsn>`               |
| Runtime        | `SENTRY_ENVIRONMENT`                    | `production`                     |
| Runtime        | `SENTRY_TRACES_SAMPLE_RATE`             | Not set; see below               |
| Build argument | `NEXT_PUBLIC_SENTRY_DSN`                | `<web-sentry-dsn>`               |
| Build argument | `NEXT_PUBLIC_SENTRY_ENVIRONMENT`        | `production`                     |
| Build argument | `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Not set; see below               |
| Build argument | `SENTRY_ORG`                            | `<sentry-org>`                   |
| Build argument | `SENTRY_PROJECT`                        | `<web-sentry-project>`           |
| Build secret   | `SENTRY_AUTH_TOKEN`                     | `<sentry-auth-token>`; see below |

`<web-sentry-dsn>` is the DSN of the Sentry project of the web application. The browser receives the DSN, so it is not a secret. `SENTRY_ENVIRONMENT` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT` set the environment that Sentry files the events under. `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` set the share of requests and page loads whose traces the web application sends, from `0` to `1`. Their default is `0.1`. A build with an invalid browser value fails. With an invalid server value, the server starts but logs the invalid variable and answers every request with an error, so the health check fails.

The events carry no error message, request body, query, cookies, headers or user data, no file paths or addresses of system errors, and no breadcrumbs, because these can show a Document, a file name of a Trading Partner, a token or a session. The traces carry no URL query.

`<sentry-auth-token>` is a Sentry auth token that may upload source maps. When `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are all set, the build creates a release and uploads the source maps of the web application to that org and project, so Sentry shows the original code in stack traces. The build deletes the source maps after the upload, so the browser cannot load them. Without any of the three, the build uploads nothing and creates no release. The Dockerfile reads the token as the build secret `SENTRY_AUTH_TOKEN`, not as a build argument, so it stays out of the image and its build history. With Docker, pass it with `--secret id=SENTRY_AUTH_TOKEN,env=SENTRY_AUTH_TOKEN`. Store the token in Dokploy and do not commit it.

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
