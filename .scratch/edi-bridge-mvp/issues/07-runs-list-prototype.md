# 07: Runs list prototype

**What to build:** Operations users see all Runs in a filterable table: status (received, processing, delivered, failed, duplicate), Failure Stage, Trading Partner, Message Type, Flow, time range, and whether it was a Manual Submission. The table stays responsive with tens of thousands of Runs.

**Blocked by:** 06 (Mock stack tracer)

**Status:** done

- [x] All listed filters work against the mocked data
- [x] The table stays responsive with 10,000+ mocked Runs
- [x] Status and Failure Stage are visually distinct and readable without relying on colour alone
- [x] The table is fully keyboard-operable
- [x] Selecting a Run navigates to its detail page (placeholder until ticket 08)
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #7 (feat/07-runs-list-prototype).
