# 38: Duplicates

**What to build:** An Interchange received again with the same sender and Interchange control reference is recorded as a Duplicate and not processed, so the ERP never receives an order twice.

**Blocked by:** 35 (Inbound SFTP and ORDERS to the ERP)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline)
- [ ] The second copy yields a Run with status duplicate and no delivery
- [ ] The same control reference from a different sender is not a Duplicate
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
