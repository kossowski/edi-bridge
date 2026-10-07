# 31: Runs from Manual Submission

**What to build:** The first pipeline slice: a Manual Submission of an invoice Document on an inbound Channel is queued, picked up by the worker, routed by its Flow, mapped with the pinned Mapping Version and validated as INVOIC. The Run is recorded with its status, steps, Mapping Version and output, and is marked manual. The Runs list and Run detail work on real data.

**Blocked by:** 30 (Channels and Flows live)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline: a Document arriving on a Channel → Run outcome; Testcontainers for Postgres and Redis)
- [ ] Manual Submission goes through exactly the same pipeline as Channel traffic
- [ ] A successful Run records status, steps with timings, Mapping Version and the generated INVOIC
- [ ] A validation failure stops the Run at the validation stage; invalid EDIFACT is never stored as deliverable output
- [ ] Raw Documents are stored behind a storage interface
- [ ] Expected failures are typed Effect errors, not exceptions
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
