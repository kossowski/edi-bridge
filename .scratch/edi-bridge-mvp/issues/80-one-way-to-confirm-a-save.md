# 80: One way to confirm a save

**What to build:** The app confirms a finished action the same way everywhere. Ticket 65 added an app-wide toast host, but the add-a-partner wizard's success notice (ticket 63), the undo for a code translation (ticket 67) and the confirmation of a renamed field (ticket 68) confirm inline on the page.

The rule needs a product decision. Proposal: a toast confirms a short action and offers its undo; an inline notice stays for results the user has to read or act on, such as what the wizard left for later.

**Blocked by:** None (can start immediately)

**Status:** needs-info

- [ ] The rule is decided and written down where screen authors find it
- [ ] The screens from tickets 63, 65, 67 and 68 follow it
- [ ] Toasts are announced to screen readers, and an undo in a toast can be reached with the keyboard
