# 42: Partner onboarding and Test Mode

**What to build:** New Trading Partners start in Test Mode: their Interchanges carry the test indicator in the UNB envelope. The onboarding checklist is derived from actual traffic (identity set → test Interchange sent → CONTRL received), and the switch to production is explicit.

**Blocked by:** 39 (CONTRL, Acknowledgements and Overdue)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline and API routes)
- [ ] Interchanges to and from a partner in Test Mode carry the test indicator
- [ ] Checklist steps complete based on real events, not manual ticks
- [ ] Switching to production is only possible explicitly
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
