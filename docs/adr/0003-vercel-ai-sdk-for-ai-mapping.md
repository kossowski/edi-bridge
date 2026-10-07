# Vercel AI SDK for AI-drafted Mappings, not Effect AI

AI-drafted Mappings use the Vercel AI SDK: structured output validated against the Zod Mapping schema, a tool loop in which the model runs its draft against a sample Document and corrects validation errors, and streamed partial output so links appear on the canvas as they are produced. Despite the Effect core, we don't use Effect's `ai` module: in Effect 4.0 it is marked `@stability unstable` and it works with Effect Schema, which would force a second schema system next to Zod (see ADR-0004).

## Considered Options

- **TanStack AI**: rejected; younger and less proven for multi-step tool loops.
- **Effect `ai` module**: rejected for the reasons above; worth revisiting once it is stable.
