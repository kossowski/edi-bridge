# 09: Trading Partners prototype

**What to build:** Admins see and edit Trading Partners: identity (GLN), syntax settings, Test Mode, Acknowledgement time limit, and an onboarding checklist (identity set → test Interchange sent → CONTRL received → production on). The detail page also lists the partner's Channels, Flows and recent Runs. The Workspace's own company identity is editable in Settings.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] List and detail screens with create and edit forms
- [ ] GLN input is validated (13 digits, check digit)
- [ ] The onboarding checklist shows each step's state and the explicit switch to production
- [ ] The detail page shows the partner's Channels, Flows and recent Runs from mocked data
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
