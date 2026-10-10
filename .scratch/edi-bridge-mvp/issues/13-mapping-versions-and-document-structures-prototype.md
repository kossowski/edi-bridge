# 13: Mapping Versions and Document Structures prototype

**What to build:** Admins work on a Draft, publish it as an immutable Mapping Version, browse versions, and compare two versions including their outputs for the same Document. They create Document Structures from a sample Document (JSON or CSV) or a JSON Schema, adjust inferred structures, and set CSV specifics (delimiter, header row, character encoding including Windows-1252).

**Blocked by:** 11 (Mapping canvas prototype: trees and links)

**Status:** done

- [x] Draft vs. published state is always visible; publishing creates a new version
- [x] Version list and a comparison view (mapping differences and output differences for the same Document)
- [x] Create a Document Structure from an uploaded sample or a JSON Schema, then adjust optional/repeating fields
- [x] CSV settings: delimiter, header row, encoding
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #35, #38, #43, #46, #48, #49
