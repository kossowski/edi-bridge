# 61: Orders list and order page

**What to build:** `/orders` replaces the Order Lifecycle search with a list of orders: order number, partner, overall status (on track, needs attention, waiting for a partner, done), filters and a search for order number or partner. `/orders/[number]` shows one order as a vertical timeline from purchase order through dispatch advice to invoice, with a verdict on top, the receipt confirmation state of each step, and the next step inside the step that needs it (for example an overdue receipt confirmation with a copyable message for the partner). Each step links to its document. Reference: `/lab/orders` and `/lab/orders/[order-number]` (Timeline variant) on `feat/19-ux-lab`.

**Blocked by:** 60 (Document page with "what to do")

**Status:** ready-for-agent

- [ ] The list shows each order's overall status readable without colour, filters by status, and searches order number and partner, with a no-result state
- [ ] The order page shows the timeline with partial lifecycles, receipt confirmation states (pending, accepted, rejected, overdue) and the waiting time against the partner's limit
- [ ] An overdue step offers a copyable message for the partner; a failed step links to its document's "what to do"
- [ ] Each step links to its document page
- [ ] The Order Lifecycle contract gains the order list with overall status; the live API follows in ticket 40
- [ ] `/order-lifecycle` and its stories are removed or moved; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
