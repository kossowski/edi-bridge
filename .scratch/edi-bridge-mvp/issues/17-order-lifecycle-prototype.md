# 17: Order Lifecycle prototype

**What to build:** Business users search by Business Reference (e.g. an order number) and see the Order Lifecycle as a timeline: ORDERS → DESADV → INVOIC with their Acknowledgements and states.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Search by Business Reference with no-result and partial-lifecycle states
- [ ] Timeline across Message Types with Acknowledgement state per Interchange (pending, accepted, rejected, overdue)
- [ ] Each entry links to its Run detail
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
