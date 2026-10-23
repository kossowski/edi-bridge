# Known flakes

CI failures that are known to come from timing or memory, not from the change under test. The ticket lead checks this list before it re-runs a failed CI job.

A failure that is not listed here is real until a sub-agent shows that the same test fails on `main` at the same commit. A new flake gets a row with its owner ticket; the engineering lead gives the ticket number.

| Test or job                                                                      | Symptom                                                                                             | Owner ticket         | What to do                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| Storybook canvas stories (`test:canvas`)                                         | `VITEST_BROWSER_CONNECTION_CLOSED` under memory pressure: the OOM killer ends the Chromium renderer | #240                 | Re-run once. Locally, run it only through the slot script, as "Full check" in `checks.md` says. |
| `apps/worker/src/run-worker.test.ts`: "publishes a stuck Run its sweep released" | `vi.waitFor` times out under load                                                                   | none yet             | Re-run once. A second failure is real.                                                          |
| ssh2 test key pairs in the channel tests                                         | About 1 run in 256 generates a malformed ed25519 key pair                                           | #498, part 2 (fixed) | Treat as real: the fix regressed.                                                               |
