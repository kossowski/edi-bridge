# 57: Help & glossary page and plain names

**What to build:** A Help & glossary page at `/help`, linked at the bottom of the sidebar, explains the EDI words in plain language: the on-screen label, the technical term and a short explanation. Shared plain names for Message Types, statuses and Failure Stages ("Purchase order", "Needs attention", "The file could not be read") and a small term component that explains a word on hover or focus are added, so later screens use them instead of raw codes. Reference: `/lab/help`, `plain-language.ts` and `term.tsx` on `feat/19-ux-lab`.

**Blocked by:** 56 (App frame with account menu and two-row header)

**Status:** ready-for-agent

- [ ] `/help` lists every on-screen label from ticket 55 with its technical term and explanation, and can be searched
- [ ] Message Types, Run statuses and Failure Stages have plain names in one shared place; the EDIFACT code stays available as secondary text
- [ ] The term component explains a word on hover and keyboard focus and links to its entry on `/help`
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
