# 55: On-screen labels and task-first navigation

**What to build:** Record the decision from the UX lab: the screens use plain on-screen labels and a navigation grouped by task (daily work, setup, advanced), while the glossary terms stay the names in the domain model, the contracts, the API and the code. `GLOSSARY.md` gets the on-screen label for each term, and an ADR in `docs/adr/` records the navigation, the labels and the route changes (no redirects).

**Blocked by:** None

**Status:** ready-for-agent

- [ ] Each glossary term shown on screen lists its on-screen label in English and German; at least: Run → Document, Interchange → Transmission, Order Lifecycle → Order, Lookup Table → Code translation, Document Structure → Data format ("Your data formats"), Channel → Connection, Flow → Document route, Acknowledgement → Receipt confirmation, Retry → Try again, Reprocess → Process again, Manual Submission → Upload, Sample Document → Example document, Test Mode → Testing, Business Reference → Order number, and the Message Types ORDERS → Purchase order, DESADV → Dispatch advice, INVOIC → Invoice, CONTRL → Receipt confirmation
- [ ] The glossary states that on-screen labels may use words that the domain terms list under _Avoid_ (for example "Upload", "Example"), and that commits, tickets and code keep the domain terms
- [ ] An ADR records the sidebar groups (Daily work: Home, Documents, Orders; Setup: Trading partners, Mappings, Code translations, Your data formats; Advanced, collapsible: All connections, All document routes, Transmissions; Help & glossary and the account menu at the bottom), the new routes (`/` Home, `/tasks`, `/first-steps`, `/documents`, `/orders`, `/code-translations`, `/data-formats`, `/help`) and that the old routes (`/runs`, `/interchanges`, `/order-lifecycle`, `/lookup-tables`, `/document-structures`) go away without redirects
- [ ] The ADR names what stays unchanged: the global Channels and Flows screens keep their current pages and routes and are only relabelled
