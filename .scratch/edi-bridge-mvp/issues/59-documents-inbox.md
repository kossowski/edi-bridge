# 59: Documents inbox

**What to build:** `/documents` replaces the Runs list, the Interchange page and the Manual Submission dialog. Each row reads as a sentence ("Invoice 4711 to Acme"): partner, document type, order number (linked to the order), time, whether it was uploaded by hand, and for problems the headline and who fixes it, with a "What to do" button. Status filters (Needs attention, In progress, Done, All, with counts) sit in the page content, not in the header, next to a search for order number or partner and filters for partner and document type. A "Transmissions" view groups the documents by the file they arrived or left in. Uploading a document opens a sheet. Reference: `/lab/documents` on `feat/19-ux-lab`.

**Blocked by:** 57 (Help & glossary page and plain names)

**Status:** done

- [x] Rows show the listed facts; "Needs attention" rows have no red background, other red accents stay; status is readable without colour
- [x] Status filters, search, partner and document-type filters combine and can be cleared; the chosen status and view are kept in the URL (`?status=`, `?view=transmissions`)
- [x] The Transmissions view lists each file with its control reference, direction, partner and contained documents
- [x] The upload sheet replaces the Manual Submission dialog: pick where the document comes from, add the file, see the result and open it
- [x] The list stays responsive with 10,000+ documents and is fully keyboard-operable
- [x] Empty states distinguish "nothing matches", "nothing needs attention" and "no documents yet"
- [x] `/runs`, `/interchanges/[id]` and the Manual Submission dialog are removed with their stories, or their stories move to the new screen; tests stay green
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #91, #96, #101, #PART4.
