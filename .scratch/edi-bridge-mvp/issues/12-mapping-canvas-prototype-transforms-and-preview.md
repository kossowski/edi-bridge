# 12: Mapping canvas prototype: transforms and preview

**What to build:** Admins place transform nodes between source and target (constant, concatenate, split, substring, date format, number format, Lookup Table, conditional, loop over line items, JSONata expression), configure them, and see a live preview of the target Document for a chosen sample.

**Blocked by:** 11 (Mapping canvas prototype: trees and links)

**Status:** done

- [x] Every transform from the catalogue can be placed, connected and configured
- [x] The JSONata node offers an expression editor
- [x] A preview panel shows a mocked target Document for a chosen sample and updates when the Mapping changes
- [x] Invalid configurations are shown on the affected node
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #23, #24, #26, #27
