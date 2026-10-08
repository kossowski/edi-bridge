# Fastify for HTTP, Effect for domain processing

We use Fastify for HTTP routing, Zod request validation, and the `better-auth` handler. We use Effect for the Mapping engine, Run processing in BullMQ workers, Channel input and output, retries, and scheduling.

Effect provides typed failures for parsing, Mapping, and delivery. It also provides retry schedules, timeouts, and SFTP connections with safe resource cleanup. Fastify keeps the HTTP layer small and familiar to contributors. Although Effect has its own HTTP stack, we accept the overlap to keep these responsibilities separate.

## Considered options

We rejected these alternatives:

- Using Effect throughout the application with `effect/http-api`. At the time of this decision, Effect 4.0 had been stable since 2026-10-01. Its `http` and `http-api` modules still had the `@stability unstable` annotation. Those modules could change incompatibly in minor releases. We rejected that risk for the public API. Contributors would also need Effect knowledge for HTTP work, where Effect offers the least benefit.
- Using Fastify throughout the application with occasional Effect use. Run processing would rely on exceptions and ad hoc `try` and `catch` blocks for failures and retries.
