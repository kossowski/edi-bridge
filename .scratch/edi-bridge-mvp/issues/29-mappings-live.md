# 29: Mappings live

**What to build:** Mappings are stored via the real api: one Draft per Mapping, publishing creates an immutable Mapping Version, versions can be listed and compared (including outputs for the same Document), and the live preview runs the real engine.

**Blocked by:** 27 (Mapping engine: outbound), 25 (Lookup Tables live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Saving a Draft never changes a published Mapping Version
- [ ] Publishing creates a new immutable version
- [ ] Comparison returns mapping differences and output differences for a given Document
- [ ] Preview runs the real mapping engine against a sample
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
