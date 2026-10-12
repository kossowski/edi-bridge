# 60: Document page with "what to do"

**What to build:** `/documents/[id]` replaces the Run detail. A failed document starts with the problem: what happened in plain words, who fixes it (you, try again, the partner), and numbered steps of what to do with a deep link to the place where the cause is fixed (the Mapping at the failing field via `?field=`, the code translation with the missing code prefilled, the connection). After the fix the user processes the document again from the same page, with a choice of Mapping Version and a note when the fix is still unpublished. Delivery failures offer Try again. Partner failures offer a copyable message for the partner and "Mark as waiting for partner". Delivered, in-progress and duplicate documents get a short verdict instead (duplicates link to the original). Below come the path of the document as a stepper (received, read, checked, translated, delivered) and tabs for Summary, Content (the lines as a readable table) and Technical details (raw EDIFACT with the error position, parsed tree, step timings). Reference: `/lab/documents/[document-id]` on `feat/19-ux-lab`.

**Blocked by:** 59 (Documents inbox)

**Status:** done

- [x] Each Failure Stage shows its plain explanation and who fixes it; the fix link opens the exact place (Mapping field, code translation with the code, connection, partner)
- [x] "Process again" lets the user pick a Mapping Version (newest first, the one used before marked) and warns with a link when the Mapping has unpublished changes
- [x] "Try again" appears only for delivery failures; partner failures offer the copyable message and "Mark as waiting for partner"
- [x] After "Process again" or "Try again" the page shows that a new attempt started and links to it
- [x] The path stepper marks the failed step and explains each step on hover and focus
- [x] Technical details keep everything the Run detail showed: raw Interchange with the error position, parsed tree, Mapping Version, replaced and replacing Runs
- [x] The Run contract gains the problem explanation (who fixes it, deep-link target, missing code or field) and the waiting-for-partner mark; the live API follows in ticket 37
- [x] `/runs/[id]` and its components and stories are removed or moved; tests stay green
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #107, #110, #115, #116, #121.
