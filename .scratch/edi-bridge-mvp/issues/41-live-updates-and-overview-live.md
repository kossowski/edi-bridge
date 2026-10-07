# 41: Live updates and Overview live

**What to build:** The dashboard updates live: workers publish events via Redis pub/sub, the api streams them as Server-Sent Events, and web updates or invalidates its TanStack Query caches. The Overview shows real throughput, error rate, health per Trading Partner and Overdue Acknowledgements.

**Blocked by:** 39 (CONTRL, Acknowledgements and Overdue)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes for metrics; event delivery covered at the api seam)
- [ ] A new or changed Run appears in the Runs list without reloading
- [ ] Overview metrics are computed from real data
- [ ] The SSE connection recovers after a disconnect
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
