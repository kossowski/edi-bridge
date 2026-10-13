# 78: Filters and links into the documents inbox

**What to build:** The browser's Back button undoes a filter change on the orders list and the documents inbox. Today each filter change replaces the current history entry, so Back leaves the page (ticket 61). "See what failed" on a failing Mapping in the mappings overview opens the documents that need attention, not the Mapping (ticket 64).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Each filter change on the orders list and the documents inbox adds a history entry, and Back restores the previous filters
- [ ] Typing in a search field doesn't add an entry per keystroke
- [ ] "See what failed" opens the documents inbox filtered to documents that need attention, narrowed to that Mapping if the inbox can filter by it
- [ ] Interaction stories cover Back after a filter change and the "See what failed" link
