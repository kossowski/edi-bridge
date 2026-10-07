# Own EDIFACT syntax package instead of a third-party library

We write our own `packages/edifact` (tokenizer, parser, serializer) with hand-typed structure definitions only for the Message Types we support, instead of depending on an existing library. The UI needs position-exact errors (segment, element, component) to highlight problems in raw Interchanges, the core needs typed failures, and partners need byte-exact output; the TypeScript options at the time (node-edifact and ts-edifact: unmaintained; EDIFlow: months old with a single maintainer) either can't provide this or are too risky at the heart of the product. EDIFACT syntax itself is small; the cost lies in the message definitions, which we limit to what we use.

## Consequences

- Correctness was cross-checked once against node-edifact and EDIFlow (same sample Interchanges, compared results). This was a one-off check during development; neither library is a dependency or part of the test suite.
- Supporting a new Message Type means hand-writing its definition.
