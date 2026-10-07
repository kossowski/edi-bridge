# 44: Document retention

**What to build:** Raw Documents are deleted once they exceed their Workspace's retention period, so storage doesn't grow without bound.

**Blocked by:** 31 (Runs from Manual Submission)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline; time driven by Effect's test clock)
- [ ] The retention period is configurable per Workspace
- [ ] Expired Documents are removed; Run metadata remains
- [ ] Reprocess is unavailable for Runs whose Document has expired, with a clear reason
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
