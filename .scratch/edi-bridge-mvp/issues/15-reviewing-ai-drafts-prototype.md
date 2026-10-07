# 15: Reviewing AI drafts prototype

**What to build:** Admins ask the AI for a Mapping draft (pick a sample Document and a target Message Type), watch proposed links appear on the canvas one by one, see AI-proposed links marked as such, and accept or reject each link individually. The UI also covers the daily token budget being used up, and Viewers see no AI features.

**Blocked by:** 12 (Mapping canvas prototype: transforms and preview)

**Status:** ready-for-agent

- [ ] A mocked stream adds links to the canvas progressively
- [ ] AI-proposed links are visually distinct until accepted or rejected
- [ ] Accept/reject per link and for all remaining links
- [ ] Budget-exhausted state and the Viewer state (AI hidden) are covered
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
