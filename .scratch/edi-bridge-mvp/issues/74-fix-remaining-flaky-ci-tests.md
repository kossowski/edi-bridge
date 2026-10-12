# 74: Fix remaining flaky CI tests

**What to build:** Ticket 73 fixed the flaky tests known at the time. More tests have failed on CI since #147 landed, and pass when the job is retried. Ticket 73 also left two slow spots that can turn into failures on a busy CI runner. Fix the cause in each test: wait for the state the test checks, or give work that is slow on a CI runner the time it needs. Don't skip or delete a test.

| Test                                                                 | Failed in CI job                | Symptom                                                                          |
| -------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `document-structure-screen.stories.tsx` > Default                    | 38313212673 (main), 38313704995 | Unable to find the link "Hansemarkt: ORDERS to ERP JSON" after about 4.9 s       |
| `mapping-comparison-screen.stories.tsx` > Unavailable                | 38313120863                     | Unable to find the text "Mapping differences unavailable" within the 1 s default |
| `packages/mocks` tests                                               | none yet                        | Take about 4 s of their 5 s timeout on CI                                        |
| `mapping-canvas-story-helpers.ts` `openDetails`, used by ~30 stories | none yet                        | Returns the sheet before focus has moved into it                                 |

The canvas stories that failed on the `feat/67-*` branches ("30 links", the transform stories) fail the same way on every branch of that stack, so they come from ticket 67's changes, not from flaky tests.

**Blocked by:** none

**Status:** done

- [x] Document Structure Default waits for the data its link depends on, and the reason it takes about 5 s to render is known and fixed or recorded
- [x] Mapping Comparison Unavailable waits for the error state instead of racing the 1 s default
- [x] The `packages/mocks` tests run well within their timeout on a CI runner
- [x] `openDetails` waits until focus is inside the sheet
- [x] Each fixed test passes five times in a row locally

## Comments

Resolved in #150.
