# 19: Screen tests after UX iteration

**What to build:** Once the maintainer has finished iterating on the UX and declared the screens final, lock their behaviour in with tests: Storybook interaction stories and Playwright happy paths per screen, against the MSW handlers.

**Blocked by:** 07 (Runs list prototype), 08 (Run detail prototype), 09 (Trading Partners prototype), 10 (Channels, Flows and Manual Submission prototype), 11 (Mapping canvas prototype: trees and links), 12 (Mapping canvas prototype: transforms and preview), 13 (Mapping Versions and Document Structures prototype), 14 (Lookup Tables prototype), 15 (Reviewing AI drafts prototype), 16 (Overview prototype), 17 (Order Lifecycle prototype), 18 (Login, Settings and Operator area prototype)

**Status:** needs-triage

- [ ] The maintainer has declared the UX final and moved this ticket to ready-for-agent
- [ ] Every screen from tickets 07–18 has interaction stories covering its main behaviours
- [ ] Every screen has a Playwright happy path against mock mode, running in CI
- [ ] Tests verify behaviour through the UI, not implementation details
- [ ] If this ticket is too large for one context, it is split per screen area before starting
