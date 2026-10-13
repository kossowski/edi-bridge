# 81: Start an AI draft when creating a Mapping with AI

**What to build:** "Create with AI draft" creates a Mapping and starts the AI draft from a Sample Document. Today the create request sends only the Message Type, so the new Mapping has no Sample Document and the draft always stops at "This Mapping has no Sample Documents yet" (ticket 66).

Where the Sample Document comes from needs a product decision, for example: the user uploads one in the create step; the user picks a recent Document of that Message Type; or the latest matching Document is taken automatically.

**Blocked by:** None (can start immediately)

**Status:** needs-info

- [ ] The source of the Sample Document is decided
- [ ] The create contract carries what the decision needs, and the MSW handlers follow it
- [ ] "Create with AI draft" ends with a running AI draft, not the empty Sample Document notice
- [ ] Without a usable Sample Document, the user is told what to add before the draft starts
