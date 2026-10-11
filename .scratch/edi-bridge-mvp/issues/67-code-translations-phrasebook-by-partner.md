# 67: Code translations "Phrasebook by partner"

**What to build:** `/code-translations` replaces the Lookup Tables screens. Lists are grouped by who receives them (sent to every partner, only for one partner). Each list reads as a phrasebook: "your value → what the partner gets", with the meaning of every code, inline editing, and the Mappings that use it. A code that made documents fail (for example unit `KRT`) shows as blocking, with "Add KRT" opening the list with the code prefilled (`?add=KRT`); after saving, the page offers "Now process the document again" back to the document. A new list starts from what is written differently (for example units, VAT codes) and who receives it, with AI-suggested first values to accept or change. CSV import stays available. Reference: `/lab/lookup-tables`, `/lab/lookup-tables/[id]` and `/lab/lookup-tables/new` on `feat/19-ux-lab`.

**Blocked by:** 60 (Document page with "what to do")

**Status:** ready-for-agent

- [ ] Lists are grouped by who receives them and show the Mappings that use them
- [ ] Values can be added, edited and removed inline, with the code's meaning and an undo after removing
- [ ] Blocking codes from failed documents appear with a prefilled add action and lead back to the document after saving
- [ ] A new list asks only the kind and who receives it; suggested values can be accepted or edited one by one
- [ ] CSV import keeps reporting validation errors per row
- [ ] The Lookup Table contract gains missing codes per table and suggested values; the live API follows in tickets 37 and 72
- [ ] `/lookup-tables` and its screens and stories are replaced; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
