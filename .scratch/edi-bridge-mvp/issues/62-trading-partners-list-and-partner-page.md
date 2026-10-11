# 62: Trading partners list and partner page

**What to build:** `/trading-partners` shows each partner as a status card: name with "Open partner" as the primary button at the top right, mode (live or testing), setup progress, documents today, open problems and last activity. The cards have no next-step buttons. The partner page has tabs in the header row: Overview (setup progress with the next step, what flows with this partner, documents of the last 7 days, open problems), Connections (the partner's connections and the shared ones of your systems, adding one in a sheet that asks which way documents travel and how, and testing it), Documents (the document types exchanged, each with its connection and Mapping, adding one in a sheet: which document, which connection, which Mapping or a new one drafted by AI, and moving to a newer Mapping Version) and Settings (name, GLN, character set, wait time for a receipt confirmation). A partner in testing can send a test document and go live once it is confirmed. Reference: `/lab/partners` and `/lab/partners/[partner-id]` on `feat/19-ux-lab`.

**Blocked by:** 57 (Help & glossary page and plain names)

**Status:** ready-for-agent

- [ ] Cards show the listed facts and only "Open partner" as an action; an empty Workspace gets "Add your first trading partner"
- [ ] The partner page tabs are kept in the URL (`?tab=`) and render in the header's tab row
- [ ] Adding a connection creates a Channel for this partner; "Test connection" shows success or a plain error ("Login was rejected …")
- [ ] Adding a document type creates a Flow; choosing "Create a new one with AI" creates the Mapping and starts its AI draft
- [ ] A document type with a newer Mapping Version offers to move to it explicitly
- [ ] Testing partners can send a test document and switch to live only explicitly, after the receipt confirmation arrived
- [ ] The contracts gain the connection test and the test document; the live API follows in tickets 30 and 42
- [ ] The current partner list, detail and edit screens and their stories are replaced; the global Channels and Flows screens stay; tests stay green
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
