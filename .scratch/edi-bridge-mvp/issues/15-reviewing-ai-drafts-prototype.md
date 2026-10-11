# 15: Reviewing AI drafts prototype

**What to build:** Admins ask the AI for a Mapping draft (pick a Sample Document and a target Message Type). While the AI works, which takes minutes, they see its progress steps. The proposed links appear on the canvas only after they pass the check against the Sample Document. The Admin reviews the Draft as a whole: a review panel lists what needs attention first, the preview shows the target Document the Draft produces, and individual links can be rejected or edited. One "Accept draft" action ends the review. Until then the Draft can't be published; after it, the Draft stays editable as usual. The UI also covers the daily token budget being used up, and Viewers see no AI features.

**Blocked by:** 12 (Mapping canvas prototype: transforms and preview)

**Status:** ready-for-agent

- [ ] A mocked stream shows the AI's progress steps (e.g. reading the sample, looking up segments, links drafted, checking against the sample, fixing errors); links reach the canvas only after the check
- [ ] AI-proposed links are visually distinct on the canvas until the Draft is accepted
- [ ] A review panel lists what needs attention first: required target elements left unmapped, links with Transforms or Lookup Tables, validation warnings
- [ ] Individual AI-proposed links can be rejected or edited; an edited link no longer counts as AI-proposed
- [ ] "Accept draft" ends the review; publishing is unavailable while the review is open, and the accepted Draft stays editable
- [ ] Budget-exhausted state and the Viewer state (AI hidden) are covered
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
