# 04: First Dokploy deploy of the skeleton

**What to build:** The walking skeleton runs on the VPS via Dokploy, proving the deploy path (environment variables, routing between web and api, image builds within the VPS's memory) before there is any logic to blame.

**Blocked by:** 03 (Dockerfiles, full-stack Compose profile and CI)

**Status:** ready-for-human

- [ ] The maintainer connects the repository in Dokploy (GitHub app) for web, api and worker plus Postgres and Redis
- [ ] A push to main deploys all three apps
- [ ] The deployed web page loads and the deployed api health route reports healthy
- [ ] Builds on the VPS complete without exhausting memory; if they don't, this is noted for switching to images built in CI
- [ ] Required environment variables are documented
