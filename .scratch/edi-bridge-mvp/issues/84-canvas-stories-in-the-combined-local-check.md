# 84: Canvas stories in the combined local check

**What to build:** `pnpm check` passes locally on the 11 GB development machine. It sometimes fails in the mapping canvas stories with `VITEST_BROWSER_CONNECTION_CLOSED` under memory pressure; the same stories pass when run alone and on CI (tickets 62, 63). Ticket 50 limited the local concurrency; this crash happens despite it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The cause of the browser connection loss is found, for example peak memory of the canvas stories or another task running alongside
- [ ] `pnpm check` passes five times in a row locally
- [ ] CI keeps its current duration
