# 02: API, worker and local infrastructure

**What to build:** Developers can start the local infrastructure (Postgres, Redis, an SFTP server) with one Docker Compose command and run an empty Fastify api and an empty worker natively. The api exposes a health route reporting database and Redis reachability; the worker starts, connects to Redis and reports its health. Vitest is wired into the test task.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] One Compose command starts Postgres, Redis and an SFTP server (the same SFTP image later used by integration tests)
- [x] The api health route reports healthy only when Postgres and Redis are reachable, and unhealthy otherwise
- [x] The worker process starts, connects to Redis and exposes a health check that turns unhealthy when Redis is unreachable
- [x] Both apps run natively via the monorepo's dev command alongside web
- [x] A test task runs Vitest across packages; the api health route is covered by a test via Fastify request injection
- [x] Both apps use the shared ESLint and TypeScript configs
