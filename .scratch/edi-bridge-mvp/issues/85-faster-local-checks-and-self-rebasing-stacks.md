# 85: Faster local checks and self-rebasing stacks (ux lab retro)

**What to build:** Implementers and orchestrators spend less time and memory on local checks, and a stack reports ready only on the current `main`. The retro of the UX lab run (tickets 54–71) found:

- Implementer subagents ran the full `pnpm check` 432 times, most of them two or more times: lint and type errors only surfaced in the full check, stale `.next/dev` types from a dev server broke `check-types`, and Chromium dropped its connection when `next build` and browser tests ran side by side. Each full run peaks near 6 GB on the 11 GB machine.
- 11 of 16 stacks reported ready on a stale `main` and had to be rebased afterwards, three with conflicts. Leftover background shells, monitors, subagents and scratchpad screenshots had to be cleaned up by hand.
- Node's compile cache in `/tmp` grew to 2.4 GB.
- Several tests and stories flaked at the 5 s vitest timeout; more sit near it.
- The code-review skill looks for `CODING_STANDARDS.md`, and the repo has none.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `pnpm check:fast` runs lint, type check and unit tests only; `pnpm check` runs its tasks one at a time, so `next build` and Chromium never run together locally
- [x] `check-types` in `apps/web` passes when `.next/dev/types` holds types of a removed route
- [x] The orchestrate skill has implementers run `pnpm check:fast` before `pnpm check` and stop the dev servers they start
- [x] The orchestrate skill catches a stack up with `main` before reporting, names the `main` commit in the report, cleans up its background work, and sends the report to the session that started it
- [x] The land skill stops when the bottom PR is behind or in conflict with `main`, and its tmp cleanup also removes Node's compile cache
- [x] A local vitest run fails when a single test or story takes longer than 3 s, without changing the test timeout
- [x] `CODING_STANDARDS.md` holds the repo's judgement rules for the Standards axis of the code review

## Comments

Resolved in #154.
