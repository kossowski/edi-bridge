# Coding standards

Judgement rules for writing and reviewing code in this repo. Lint, type check and formatting rules live in their configs and are not repeated here.

## Components

- **Compose with the `render` prop.** shadcn base-nova sits on Base UI, which has no `asChild`. A `Button` rendered as a `Link` also gets `nativeButton={false}`; a link that only looks like a button is a `Link` with `buttonVariants()`. Why: Base UI otherwise gives the link button semantics and warns at runtime.
- **Derive state instead of setting it in an effect.** Compute the value during render, or update it in the event handler that causes the change. Why: a state update in an effect renders twice and hides where the change comes from.
- **Every type assertion carries a `// SAFETY:` comment** that says why the value has that type. Why: the reviewer checks the stated reason instead of reverse-engineering it.

## Styling

- **Write Tailwind classes inline.** Put derived colours in `packages/ui/src/styles/globals.css` as tokens for light and dark mode. Pass chart colours as `var(--color-<series>)` from the `chartConfig`. Why: TS constants for class strings or colours hide styling from Tailwind and the theme.

## Comments

- **Comment only a non-obvious why**, in one short line. Types, functions and files have no doc or header comments. CI workflows and config files have no comments at all. Why: the code says what it does; reasons belong in the ticket, the commit body or the PR description.

## Language

- **Code, contracts, the API, commits and tickets use the domain terms of `GLOSSARY.md`.** Plain on-screen labels (the _On screen_ entries) stay in the UI messages. Why: one name per concept across the codebase, while the screens speak to the user.

## Tests and stories

- **The first assertion waits for the data it depends on**, with `findBy…` or `waitFor`, never a fixed sleep. Each test and story stays well under its timeout (5 s for unit tests, 15 s for stories); a local vitest run fails above 3 s. Why: tests near the timeout flake under load.
- **MSW mocks serve the real API URLs** from the contracts, and cover the empty, loading, error and large-volume states in English and German. Why: a story shows what the app does against the real API, in every state a user can meet.

## Recurring review findings

These blocked parts again and again; check them before you report.

- **Identifiers and test names use the code term of `GLOSSARY.md`**, not the on-screen label.
- **A why-comment is one short line.** No doc comments, no multi-line explanations.
- **Every new story file covers the German, empty, loading and error states.**
- **`expect.any(...)` inside an object literal goes through a constant typed `unknown`**, such as `const anyTimestamp: unknown = expect.any(String)`. Otherwise `typescript/no-unsafe-assignment` fails.
- **The formatter is `oxfmt`**, not Prettier: run `pnpm format`.
- **Commit bodies vanish in the squash merge**: a finding about a commit body is not blocking. The PR title and body carry what lands.

## Tickets and texts

- **Findings and measurements go in the commit body or the PR description.** Resolving a ticket only checks its acceptance criteria; its linked PRs show where it was resolved.
- **Never write the user's name** in code, docs, tickets, commits or PRs. Record a decision by its content, not by who made it.
