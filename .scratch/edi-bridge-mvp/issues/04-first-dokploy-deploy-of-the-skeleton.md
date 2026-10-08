# 04: First Dokploy deploy of the skeleton

**What to build:** The walking skeleton runs on the VPS via Dokploy, proving the deploy path (environment variables, routing between web and api, image builds within the VPS's memory) before there is any logic to blame.

**Blocked by:** 03 (Dockerfiles, full-stack Compose profile and CI)

**Status:** done

- [x] The maintainer connects the repository in Dokploy (GitHub app) for web, api and worker plus Postgres and Redis
- [x] A push to main deploys all three apps
- [x] The deployed web page loads and the deployed api health route reports healthy
- [x] Builds on the VPS complete without exhausting memory; if they don't, this is noted for switching to images built in CI
- [x] Required environment variables are documented

## Comments

Resolved by the first Dokploy deploy, documented in e000bd4 (main).
