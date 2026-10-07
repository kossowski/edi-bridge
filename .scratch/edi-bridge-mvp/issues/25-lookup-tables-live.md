# 25: Lookup Tables live

**What to build:** Lookup Tables (per Workspace or per Trading Partner) are stored and editable via the real api, including CSV import.

**Blocked by:** 24 (Trading Partners live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Create, edit, delete tables and entries; scope to Workspace or Trading Partner
- [ ] CSV import with validation errors reported per row
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
