# 73: Fix flaky CI tests

**What to build:** Ten tests failed on CI from time to time, though their code did not change, and pass when the CI job is retried. Each failure blocks a merge until someone retries the job. Fix the cause in each test that still fails on main: wait for the state the test checks, or give work that is slow on a CI runner the time it needs. Don't skip or delete a test.

| Test                                                                                                   | Failed in CI job                      | Symptom                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `partner-wizard-mappings.stories.tsx` > Many Mappings                                                  | 38307146888 (main)                    | axe `aria-hidden-focus` on a Base UI focus guard (`span[data-base-ui-focus-guard]`) |
| `mapping-canvas-transforms.stories.tsx` > Connect By Keyboard                                          | 38307565994 (#137)                    | Unable to find the group "Link from Date format 1 (Result) to DTM+137/C507/2380"    |
| `partner-screen.stories.tsx` > Send Test Document, Confirmed On Load                                   | 38305229299, 38257175007, 38274951367 | Unable to find role="listitem"                                                      |
| `partner-screen.stories.tsx` > New Partner Without Activity                                            | 38282276429 (#130)                    | Unable to find the progress bar "Setup" within the 1 s default                      |
| `mapping-comparison-screen.stories.tsx` > Chosen Versions And Sample                                   | 38274951367                           | The status message is not in the document yet                                       |
| `mapping-canvas-ai-review-panel.stories.tsx` > Preview Loading                                         | 38257172660                           | `toBeVisible` sees the sheet during its fade-in; passes on main since #119          |
| `home-screen.stories.tsx` > Large Volume                                                               | 38247617012, 38247806609              | Unable to find the link "open problem"; passes on main since #114                   |
| `document-structure-screen.stories.tsx` > Large Volume                                                 | 38294798999                           | Times out after 15 s; only on ticket 68's branch, handed to ticket 68               |
| `packages/mocks` `home.test.ts` > serves a large volume with traffic in every bucket                   | 38305232663, 38305229299              | Exceeds the 5 s test timeout on CI; about 1 s locally                               |
| `packages/mocks` `run.test.ts` > lists each Run with the direction, Business Reference and Interchange | 38291078884                           | Exceeds the 5 s test timeout on CI                                                  |

Preview Loading waits five seconds for the sheet since #119, and Home Large Volume waits ten seconds since #114, so both need no change. Document Structure Large Volume failed only on the branch of ticket 68, which drops the `color-contrast` exclusion of axe, so ticket 68 fixes it.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] Each story in the table that still fails on main waits for the state it checks instead of racing the clock
- [ ] The axe check of Many Mappings passes without turning off `aria-hidden-focus` for the whole story
- [ ] The two `packages/mocks` tests run within their timeout on a CI runner
- [ ] Each fixed test passes five times in a row locally

## Comments
