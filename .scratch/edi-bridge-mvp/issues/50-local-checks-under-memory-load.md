# 50: Local checks under memory load

**What to build:** The full local check passes on a developer machine. Today `pnpm turbo run lint check-types test test:e2e build build-storybook` runs the Storybook browser tests, the e2e test, `next build` and `storybook build` at the same time, and on a 7-CPU, 11 GB machine Chromium runs out of memory and crashes in random story files. CI is not affected.

**Blocked by:** none

**Status:** done

- [x] Outside CI, Vitest and Playwright run one test file at a time with one worker; CI keeps its defaults
- [x] The `test` task passes `CI` through, so Vitest can tell CI from a local run under turbo's strict environment mode
- [x] `pnpm check` runs the full check locally with limited turbo concurrency
- [x] The orchestrate skill tells implementers to verify with `pnpm check`

## Comments

Resolved in #22.
