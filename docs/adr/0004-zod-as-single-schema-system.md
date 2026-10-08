# Zod as the single schema system

We use Zod for API contracts, the Mapping schema, AI structured output, forms, and validation inside Effect. We do not use Effect Schema. One schema system lets the frontend, AI SDK, and backend share schemas.

Effect's typed errors do not require Effect Schema. The domain code wraps Zod parsing in a small helper that converts a failed parse into a tagged Effect error.

## Consequences

We exclude Effect modules that require Effect Schema inputs. These include HTTP API, RPC, AI, and schema-backed Config. The exclusion is consistent with [ADR-0001](0001-fastify-edge-effect-core.md) and [ADR-0003](0003-vercel-ai-sdk-for-ai-mapping.md).
