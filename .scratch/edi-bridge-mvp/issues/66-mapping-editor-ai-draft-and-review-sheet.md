# 66: Mapping editor: AI draft and review sheet

**What to build:** The AI review moves out of the fixed right column into a sheet, opened from an amber "N need attention" button in the toolbar. The sheet lists the open items in groups (fields with nothing linked, links that change the value, warnings on the example document, other proposed links); choosing one shows it in the sheet with what to do, "Show on canvas" and a back button to the list. Only the AI-proposed links that need attention are amber on the canvas. A single AI-proposed link can be accepted from the sheet and from the link's context menu, next to accepting the whole draft. Once an AI draft has started, its dialog can't be closed until it finishes or the user stops it; "Draft with AI" is hidden while a review is open. `?ai-draft=start` starts the draft on opening. Reference: `lab-ai-draft`, `lab-ai-review-sheet` and `lab-ai-accept` on `feat/19-ux-lab`.

**Blocked by:** 65 (Mapping editor: layout, sheets and the failing field)

**Status:** ready-for-agent

- [ ] The toolbar button shows the open count in amber and opens the sheet; with nothing open it says so
- [ ] The sheet switches between list and detail with a back button and keeps keyboard focus sensible
- [ ] Only links that need attention are amber on the canvas, using the `--ai-attention` token and not colour alone
- [ ] Accepting a single link (sheet or context menu) clears its mark and the marks of its Transform Links; the rules live in a pure module with unit tests, like `ai-review-attention.ts`
- [ ] The running AI draft dialog can't be dismissed by Escape or the overlay; Stop is always available
- [ ] "Draft with AI" is hidden during an open review; `?ai-draft=start` starts the draft once
- [ ] The Mapping contract gains single-link accept and the MSW handler supports it; the real endpoint is built test-first in ticket 47
- [ ] Existing AI review stories and tests stay green or are updated in the same PR
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
