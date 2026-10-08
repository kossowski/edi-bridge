# Vercel AI SDK for AI-drafted Mappings

We use the Vercel AI SDK for AI-drafted Mappings. The SDK supports the behavior we need:

- Structured output validated against the Zod Mapping schema.
- A tool loop that lets the model run its draft against a sample Document and correct validation errors.
- Streamed partial output that lets links appear on the canvas as the model produces them.

Although domain processing uses Effect, we do not use its `ai` module. In Effect 4.0, the module has the `@stability unstable` annotation. It also uses Effect Schema, which would introduce a second schema system alongside Zod. [ADR-0004](0004-zod-as-single-schema-system.md) explains why we use one schema system.

## Considered options

We rejected these alternatives:

- TanStack AI. At the time of this decision, it was newer and less proven for tool loops with multiple steps.
- Effect's `ai` module. Its stability and schema requirements conflict with this decision. We can reconsider the module once it is stable.
