# 03: Dockerfiles, full-stack Compose profile and CI

**What to build:** Each app (web, api, worker) builds into its own container image, a separate Compose profile runs the whole stack from those images, and GitHub Actions runs lint, typecheck, tests and build on every pull request, using Turborepo so only affected packages run.

**Blocked by:** 01 (Web app and ui package skeleton), 02 (API, worker and local infrastructure)

**Status:** done

- [x] web, api and worker each have a Dockerfile producing a production image
- [x] A full-stack Compose profile starts infrastructure plus all three app images, and the health checks pass
- [x] The infrastructure-only Compose usage from ticket 02 keeps working unchanged
- [x] A GitHub Actions workflow runs lint, check-types, test and build on pull requests
- [x] Turborepo limits CI work to affected packages
- [x] The README explains local setup: start infrastructure in Docker, run apps natively
