# Fastify at the HTTP edge, Effect in the domain core

Effect ships its own HTTP stack, so using both Fastify and Effect overlaps on purpose. We use Fastify for the HTTP edge only (routing, Zod request validation, the better-auth handler) and Effect for everything behind it: the mapping engine, Run processing in BullMQ workers, Channel I/O, retries and scheduling. EDI processing is where Effect pays off (typed failures such as parse, mapping and delivery errors; retry schedules; timeouts; resource-safe SFTP connections), while a conventional Fastify API stays familiar to contributors and keeps the HTTP layer thin.

## Considered Options

- **Effect everywhere (`effect/http-api`)**: rejected. In Effect 4.0 (stable since 2026-10-01) the `http`/`http-api` modules are still marked `@stability unstable`, i.e. they may break in minor releases. We don't want the public API surface to churn with Effect minors, and it raises the barrier for contributors on the part of the system with the least need for Effect.
- **Fastify everywhere, Effect only sporadically**: rejected; error and retry handling in the pipeline would fall back to exceptions and ad-hoc try/catch.
