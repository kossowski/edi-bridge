# 37: Failure Stages, Retry and Reprocess

**What to build:** Every failed Run records its Failure Stage (parse, validation, mapping, delivery) with the error position where applicable. Operations users Retry delivery failures, Reprocess mapping failures from the original, unmodified Document with a chosen Mapping Version (the new Run links to the replaced one), and see inbound parse/validation failures as awaiting a resend from the partner.

**Blocked by:** 35 (Inbound SFTP and ORDERS to the ERP)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline and API routes)
- [ ] Each Failure Stage is recorded with typed details and positions
- [ ] Retry repeats only the delivery step
- [ ] Reprocess creates a new Run linked to the failed one, using the chosen Mapping Version
- [ ] The original Document can never be modified
- [ ] Parse/validation failures of inbound Interchanges are marked as awaiting resend
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
