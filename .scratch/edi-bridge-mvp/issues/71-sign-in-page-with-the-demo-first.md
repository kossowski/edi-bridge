# 71: Sign-in page with the demo first

**What to build:** `/login` becomes a two-column page: on one side a short value statement with three points (your ERP stays as it is, problems come with a next step, know where every order stands), on the other the sign-in form (email and password with show/hide, "Use the email address from your invite") and "Try the demo" as a first-class choice. There is still no sign-up path. Reference: `/lab/login` on `feat/19-ux-lab`.

**Blocked by:** 54 (UI components from the UX lab), 55 (On-screen labels and task-first navigation)

**Status:** ready-for-agent

- [ ] Two columns on desktop, stacked on narrow screens, with the form first
- [ ] "Try the demo" is as prominent as signing in; there is no sign-up link
- [ ] The password can be shown and hidden; errors are announced to screen readers
- [ ] The current login screen and its stories are replaced; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
