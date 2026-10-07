# 40: Order Lifecycle live

**What to build:** The Business Reference (order number from BGM or RFF+ON) is extracted from every Message, so business users can search by it and see the real Order Lifecycle across ORDERS, DESADV and INVOIC with their Acknowledgements.

**Blocked by:** 39 (CONTRL, Acknowledgements and Overdue)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Business References are extracted for ORDERS, DESADV and INVOIC
- [ ] Search returns the full chain in chronological order, including partial lifecycles
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
