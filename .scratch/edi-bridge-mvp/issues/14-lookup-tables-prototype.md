# 14: Lookup Tables prototype

**What to build:** Admins maintain Lookup Tables (e.g. ST → PCE) per Workspace or per Trading Partner in an editable table, with CSV import.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Create, edit and delete Lookup Tables and their entries
- [ ] Scope selection: Workspace or a single Trading Partner
- [ ] CSV import with a preview before applying
- [ ] Keyboard-friendly editing
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
