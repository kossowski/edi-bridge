# 18: Login, Settings and Operator area prototype

**What to build:** The login page (email and password, no sign-up), the 'View live demo' button, Workspace settings (company identity, Document retention period, AI token budget), and the Operator area: create Workspaces (optionally seeded), create invites with a role and copy their link, and reset the Sandbox Workspace.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Login page without any sign-up path, plus a 'View live demo' button
- [ ] Workspace settings for company identity, retention period and AI budget
- [ ] Operator area: Workspace list and creation (with a 'seed' option), invite creation with Admin/Viewer role and a copy-link action
- [ ] Sandbox reset action with a confirmation step
- [ ] Viewer state: all changing actions are unavailable
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
