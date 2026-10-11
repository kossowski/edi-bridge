# 58: Home, Tasks and the notification bell

**What to build:** Home at `/` replaces the Overview. It shows four key-number cards on top (Needs attention, Delivered, In progress, Waiting for a partner; each opens the matching list), a large card that promotes the mapping editor (a blurred mini mapping in the background, one button that starts an AI draft straight away with an example document and lands in the mapping editor with the draft's progress), the throughput and error charts with a 24 h / 7 days / 30 days switch, and "Your trading partners" as cards. A Workspace without any setup sees First steps at `/first-steps` instead: a checklist from GLN to go-live whose steps complete from the Workspace's real state. The Tasks page at `/tasks` lists everything that needs someone, grouped by who acts (for you to fix, try again, waiting for a partner), each with one action. The bell in the header shows the open count and the newest tasks, with a link to `/tasks`. Reference: `/lab/home`, `/lab/home/setup`, `/lab/tasks` and `lab-notifications` on `feat/19-ux-lab`.

**Blocked by:** 57 (Help & glossary page and plain names)

**Status:** ready-for-agent

- [ ] Key-number cards are links, follow the chosen time window and are readable without colour
- [ ] The promo card sits under the key numbers and above the charts; its button creates a Mapping from an example and opens it with the AI draft running, without asking anything first
- [ ] Charts are visible right away, switch between 24 h, 7 days and 30 days, and offer their values as a table
- [ ] Partner cards show mode (live or testing), documents today and open problems, and open the partner
- [ ] Home has no task list; overdue receipt confirmations and failing partners appear on `/tasks`
- [ ] First steps derives each step's state from the Workspace (GLN set, ERP connection, first partner, first published Mapping, test sent, live); the next open step is highlighted with its action
- [ ] `/tasks` groups items by who acts, gives each one action that deep-links to the fix, and has an "all good" empty state
- [ ] The bell shows the open count, lists the newest tasks and links to `/tasks`
- [ ] The tasks and Home data come from Zod contracts in the contracts package (tasks with who acts and a deep-link target; key numbers per time window); the live API follows in ticket 41
- [ ] The Overview screen, its route content and its stories are replaced; existing stories and tests stay green or are updated in the same PR
- [ ] Dummy data is generated from the area's Zod contract and served by MSW handlers at the real API URLs, covering empty, loading, error and large-volume states
- [ ] Not test-first (prototype phase): screens get Storybook stories that run the automatic accessibility checks; interaction tests and Playwright happy paths are deferred to ticket 19
- [ ] Texts are available in English and German; the screen works in dark and light mode
