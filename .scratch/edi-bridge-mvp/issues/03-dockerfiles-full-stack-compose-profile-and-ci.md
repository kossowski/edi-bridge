# 03: Dockerfiles, full-stack Compose profile and CI

**What to build:** Each app (web, api, worker) builds into its own container image, a separate Compose profile runs the whole stack from those images, and GitHub Actions runs lint, typecheck, tests and build on every pull request, using Turborepo so only affected packages run.

**Blocked by:** 01 (Web app and ui package skeleton), 02 (API, worker and local infrastructure)

**Status:** ready-for-agent

- [ ] web, api and worker each have a Dockerfile producing a production image
- [ ] A full-stack Compose profile starts infrastructure plus all three app images, and the health checks pass
- [ ] The infrastructure-only Compose usage from ticket 02 keeps working unchanged
- [ ] A GitHub Actions workflow runs lint, check-types, test and build on pull requests
- [ ] Turborepo limits CI work to affected packages
- [ ] The README explains local setup: start infrastructure in Docker, run apps natively
