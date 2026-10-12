# 68: Your data formats "Example file"

**What to build:** `/data-formats` replaces the Document Structures screens. Each format is a card showing your own example file and which Mappings read it; the card's action bar sits at the bottom even when the card is shorter than the tallest in its row. A format's page shows the example file next to the fields read from it, each named in plain words ("Unit price" for `EPreis`) with the reason the name was chosen, and lets the user rename a field. Adding a format: drop an export from your ERP, watch it being read (opening the file, finding the columns, naming the fields), confirm the names the AI was unsure about, name the format and save. Creating from a JSON Schema and the CSV settings (delimiter, header row, encoding) stay available as technical options. Reference: `/lab/document-structures`, `/lab/document-structures/[structure-id]` and `/lab/document-structures/new` on `feat/19-ux-lab`.

**Blocked by:** 57 (Help & glossary page and plain names)

**Status:** done

- [x] Cards show the example file, field count and Mappings; action bars align at the bottom of each row
- [x] The format page shows file and fields side by side; selecting one highlights the other; renaming a field updates the name shown in Mappings
- [x] Adding a format shows the reading steps, then only the unsure names to confirm; saving is blocked until they are confirmed and the format has a name
- [x] JSON Schema creation and CSV settings remain reachable; refusals of incompatible changes stay explained
- [x] The Document Structure contract gains plain field names with their reason and an unsure flag; the live API follows in tickets 26 and 72
- [x] `/document-structures` and its screens and stories are replaced; tests stay green
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #137, #139, #142, #144.
