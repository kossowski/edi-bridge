# 53: Stable story tests

**What to build:** Two stories fail on CI from time to time, though their code did not change. Each one races the clock, and a busy runner loses the race. They failed on #58 and #60 after a stack push, while the same code passed on the other PRs of the stack.

| Story                                                                         | Failed on | Cause                                                                                                       |
| ----------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `publish-draft.stories.tsx` > Nothing To Publish                              | #58       | The story ends in 109 ms, inside the dialog's 100 ms fade-in, so `toBeVisible` sees opacity 0               |
| `new-document-structure-screen.stories.tsx` > Large Windows 1252 Csv Document | #60       | Two inferences of a 20,000-row CSV through MSW take more than the 1 s `findByRole` timeout on a busy runner |

On the passing PRs, Nothing To Publish took 308 ms, and Large Windows 1252 Csv Document took 1.0–2.45 s; it failed at 2.48 s.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] Nothing To Publish waits until the dialog has faded in before it checks the alert
- [ ] Large Windows 1252 Csv Document no longer depends on the 1 s default timeout

## Comments
