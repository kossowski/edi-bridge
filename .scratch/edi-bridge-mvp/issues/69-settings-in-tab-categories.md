# 69: Settings in tab categories

**What to build:** Workspace settings split into tabs in the header row: Company (name and GLN, "This is how your partners see you", with a warning when the GLN is missing), Members (who has access and with which role) and Data & AI (how long documents are kept and the AI budget, both explained by their effect and set by the Operator). Every tab uses the same centred `max-w-4xl` layout. Reference: `/lab/settings` on `feat/19-ux-lab`.

**Blocked by:** 56 (App frame with account menu and two-row header)

**Status:** ready-for-agent

- [ ] The tabs are kept in the URL (`?tab=`) and render in the header's tab row
- [ ] Every tab has the same centred width
- [ ] Members lists users with role and last activity; inviting stays with the Operator (no email is sent in the MVP, see the spec), so Admins see who to ask
- [ ] Retention and AI budget are shown by their effect and are read-only here
- [ ] Viewers can change nothing; Admins see only what they can change as editable
- [ ] The lab's Notifications tab is left out, because the MVP sends no emails
- [ ] The current settings screen and its stories are replaced; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
