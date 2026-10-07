# 11: Mapping canvas prototype: trees and links

**What to build:** Admins open a Mapping on a React Flow canvas showing the source tree (a Document Structure or an EDIFACT Message Type) and the target tree, draw and remove links from source fields to target elements, and see what each EDIFACT segment and element means. Small screens show a clear desktop-only notice.

**Blocked by:** 06 (Mock stack tracer)

**Status:** ready-for-agent

- [ ] Source and target trees render from mocked structures, including nested and repeating parts
- [ ] Links can be drawn and removed with mouse and keyboard
- [ ] Hovering or selecting an EDIFACT segment/element shows its meaning (e.g. DTM+137)
- [ ] Works in both directions (Document Structure → Message Type and Message Type → Document Structure)
- [ ] Below desktop width, a desktop-only notice replaces the canvas
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
