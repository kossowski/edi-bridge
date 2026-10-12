# 63: Add a partner wizard

**What to build:** `/trading-partners/new` becomes a wizard that asks in business terms: who the partner is (name, GLN or "later"), which documents you exchange (receive purchase orders, send dispatch advices, send invoices, each with its benefit), how they travel (a connection form per direction, or "We'll ask the partner for these details" with a ready-made request to copy), which Mapping each document uses (an existing one or "Let AI draft one"), and a review step. The partner is created in Test Mode with its Channels, Flows and AI drafts in one go. Reference: `/lab/partners/new` on `feat/19-ux-lab`.

**Blocked by:** 62 (Trading partners list and partner page)

**Status:** done

- [x] Each step validates before "Continue" and keeps its values on "Back"; progress is shown
- [x] Missing connection details can be postponed; the copyable request lists exactly what the partner must send
- [x] Finishing creates the partner in Test Mode, its connections and document routes, and starts an AI draft for each "Let AI draft one"; the user lands on the partner page
- [x] The current partner form and its stories are replaced; tests stay green
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #118, #123, #126, #128, #134.
