# 33: Full-stack end-to-end test in CI

**What to build:** Playwright runs against the full Compose stack in CI and covers the path from Manual Submission in the UI to a delivered Run visible in the Runs list.

**Blocked by:** 32 (Outbound SFTP delivery)

**Status:** ready-for-agent

- [ ] CI starts the full-stack Compose profile and runs Playwright against it
- [ ] The test submits an invoice Document via the UI and sees the Run reach delivered
- [ ] The existing Playwright tests against mock mode keep running
