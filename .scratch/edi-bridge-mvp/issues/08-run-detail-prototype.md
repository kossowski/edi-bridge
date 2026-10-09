# 08: Run detail prototype

**What to build:** Operations users inspect one Run: a step timeline, the raw Interchange with the exact error position (segment, element, component) highlighted, a parsed tree of the Message, the Mapping Version used, links to a replaced or replacing Run, and actions to Retry (delivery failures) or Reprocess with a chosen Mapping Version (mapping failures). Runs failed at parse or validation show 'awaiting resend from partner'. An Interchange can be viewed together with all Runs it produced.

**Blocked by:** 07 (Runs list prototype)

**Status:** done

- [x] The step timeline shows each stage with timing and the failing stage
- [x] The raw Interchange view highlights the error position from the mocked error
- [x] The parsed tree view renders a mocked Message
- [x] Retry is offered only for delivery failures, Reprocess only for mapping failures; parse/validation failures show the resend state
- [x] Reprocess lets the user pick a Mapping Version
- [x] An Interchange view lists all Runs it produced
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #8 (feat/08-run-detail-prototype).
