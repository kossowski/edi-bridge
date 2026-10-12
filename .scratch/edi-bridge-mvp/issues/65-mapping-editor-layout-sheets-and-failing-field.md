# 65: Mapping editor: layout, sheets and the failing field

**What to build:** The mapping editor becomes the page: the canvas takes the full height under a thin toolbar with larger Draft and "unpublished since" badges, AI draft, preview, details, versions and publish, and no direction sentence. The transform list is docked on the left as a vertical list (click to add, or drag onto the canvas) and can be hidden. A link's actions open from a right-click context menu (and from the keyboard); the "×" on hover goes. Preview, details, and "Versions & problems" (version timeline with change notes, which partners use each version, restore into the Draft, failed documents of the last 7 days) open as sheets. Publishing asks for a change note and which document routes move to the new version. An empty Mapping shows "Start here" (AI draft from an example document, or link the fields yourself). Opened with `?field=`, the editor marks the failing field on the canvas and shows an Alert naming it with "Show the field". Reference: `/lab/mappings/[mapping-id]` on `feat/19-ux-lab` (editor, "Opened from a failure", "Empty mapping").

**Blocked by:** 64 (Mappings overview "In and out")

**Status:** done

- [x] Toolbar, docked and hideable transform list, and the full-height canvas as described; the hidden state of the transform list persists
- [x] Right-click or the keyboard opens a link's context menu with its actions; the hover "×" is removed
- [x] Preview, details and Versions & problems open as sheets and leave the canvas its full width
- [x] The version timeline shows change notes and users per version and restores a version into the Draft; the comparison page stays reachable from it
- [x] The publish dialog takes a change note and the document routes to move; nothing moves without being chosen
- [x] An empty Mapping shows "Start here" instead of a blank canvas
- [x] `?field=` marks the failing field and "Show the field" centres it without scrolling the source fields off-screen (known issue in the lab)
- [x] The Mapping contract gains the version change note and restore; the live API follows in ticket 29
- [x] The versions page is replaced by the sheet; existing canvas stories and unit tests stay green or are updated in the same PR (see tickets 51 and 53)
- [x] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [x] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [x] Texts are available in English and German; the screen works in dark and light mode

## Comments

Resolved in #112, #119, #125, #135, #138, #143.
