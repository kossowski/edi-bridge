# 16: Overview prototype

**What to build:** Operations users see live throughput, error rate, health per Trading Partner and Overdue Acknowledgements at a glance, updating live through a mocked SSE stream.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Charts for throughput and error rate over time
- [ ] Health per Trading Partner and a list of Overdue Acknowledgements
- [ ] Values update live from a mocked SSE stream without reloading
- [ ] Charts are accessible (readable in both themes, not colour-only)
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
