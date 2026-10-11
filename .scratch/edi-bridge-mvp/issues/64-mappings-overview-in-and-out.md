# 64: Mappings overview "In and out"

**What to build:** `/mappings` shows two lanes, coming in and going out. Each card is one Mapping ("Invoices to 2 partners") with the partner → ERP path, a plain status (running fine, documents failed, draft not published, never published) and one next action (see what failed, review and publish, draft with AI). Cards needing action come first. "New mapping" opens a sheet that asks only which document (for example "Invoices you send"), then creates the Mapping and opens the editor with the AI draft running. An empty Workspace gets "Translate your first document". Reference: `/lab/mappings` ("In and out") on `feat/19-ux-lab`.

**Blocked by:** 57 (Help & glossary page and plain names)

**Status:** ready-for-agent

- [ ] Lanes, card facts and the single next action per card as described; status is readable without colour
- [ ] The New mapping sheet asks only the document and lands on `/mappings/[id]?ai-draft=start`; a lane's own "Another document coming in / going out" preselects the direction
- [ ] The current Mappings table and its stories are replaced; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
