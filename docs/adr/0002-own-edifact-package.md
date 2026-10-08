# Our own EDIFACT syntax package

We implement the tokenizer, parser, and serializer in `packages/edifact`. We write typed structure definitions only for the Message Types we support.

The UI needs errors that identify the exact segment, element, and component so it can highlight problems in raw Interchanges. Domain processing needs typed failures. Trading Partners need output that matches the required bytes exactly.

At the time of this decision, `node-edifact` and `ts-edifact` were unmaintained. EDIFlow was only a few months old and had one maintainer. These TypeScript libraries either lacked the required behavior or posed too much maintenance risk for a central part of the product.

EDIFACT syntax is small enough to implement ourselves. Most of the work is in the Message Type definitions, which we limit to the types we use.

## Consequences

The decision has these consequences:

- We cross-checked correctness once against `node-edifact` and EDIFlow during development. We passed the same sample Interchanges to each implementation and compared the results. Neither library is a dependency or part of the test suite.
- Each new Message Type requires a definition written by hand.
