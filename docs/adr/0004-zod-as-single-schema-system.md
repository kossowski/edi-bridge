# Zod as the single schema system, also inside the Effect core

All schemas (API contracts, the Mapping schema, AI structured output, forms, and validation inside the Effect core) are written in Zod; we don't use Effect Schema. One schema system can be shared between the frontend, the AI SDK and the backend. Effect's typed errors don't depend on Effect Schema: the core wraps Zod parsing in a small helper that turns a failed parse into a tagged Effect error.

## Consequences

- Effect modules that take Effect Schemas as input (HTTP API, RPC, AI, schema-backed Config) are off the table. This is consistent with ADR-0001 and ADR-0003.
