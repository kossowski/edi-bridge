# 75: Accessibility fixes from the UX lab review

**What to build:** Keyboard and screen-reader users can work through the rebuilt app without getting stuck or lost. The reviews of tickets 56, 59, 64 and 71 found these gaps:

- The language menu stays open after a language is chosen, and the next click on the page only closes it (ticket 71, #76).
- After the command palette opens a result, focus lands on the page, not on its main content (ticket 56, #78).
- Tab can move focus out of an open sheet or dialog, and out of the open sidebar on mobile, because they share one dialog setup (ticket 59).
- Several links styled as outline buttons may have no visible border in light mode, for example the edit links, the cancel links of the connection and route forms, the mapping screens and the publish step (ticket 59).
- The focus ring on dark filled buttons is hard to see (ticket 64).
- On German pages, screen readers read the breadcrumb ellipsis as "More" (ticket 61).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Choosing a language closes the language menu, and the next click on the page works as usual
- [ ] After the command palette opens a result, focus is on the new page's main content
- [ ] Tab and Shift+Tab stay inside an open sheet, dialog or mobile sidebar until it closes
- [ ] Every link styled as an outline button shows its border in light and dark mode
- [ ] The focus ring is clearly visible on every button variant in light and dark mode
- [ ] The breadcrumb ellipsis has a translated label
- [ ] Each fix is covered by a story that runs the automatic accessibility checks, with an interaction test where the gap is about focus
