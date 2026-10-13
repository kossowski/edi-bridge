# 40: Order Lifecycle live

**What to build:** The Business Reference (order number from BGM or RFF+ON) is extracted from every Message, so business users can search by it and see the real Order Lifecycle across ORDERS, DESADV and INVOIC with their Acknowledgements. Recent orders are listed with an overall status.

**Blocked by:** 39 (CONTRL, Acknowledgements and Overdue)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (API routes)
- [ ] Business References are extracted for ORDERS, DESADV and INVOIC
- [ ] Search returns the full chain in chronological order, including partial lifecycles
- [ ] If this area's Zod contract doesn't exist yet, this ticket defines it in the contracts package; if it exists, the implementation conforms to it (or extends it, updating the MSW handlers alongside)
- [ ] With mock mode off, this area's screen (if it already exists) works against the real API without UI code changes; the area's MSW handlers stay in the mocks package and keep working against the same contract
- [ ] Orders are listed with their overall status (on track, needs attention, waiting for a partner, done), filterable by status and searchable by order number and partner (ticket 61)

## Comments

- The Order Lifecycle contract from ticket 17 also lists outbound Runs that failed before an EDIFACT Message existed (for example at mapping, with `interchange: null`). For those Runs, take the Business Reference from the source Document, because there is no BGM or RFF+ON to extract it from.
- The contracts give receipt confirmations no arrival time and Documents no sent time, so the screens count waiting time from when the Document was received. A sent dispatch advice or invoice without a transmission reference stays "in progress". Add these times and the reference, or keep this behaviour on purpose (ticket 61).
