# 82: Share the AI review marking rules

**What to build:** One rule decides which parts of a Draft an AI review marks as proposed. Today it exists twice: `marksProposal` in the contracts package checks a Draft against a proposal, and `reviewOf` in the mocks package builds the review from a proposal (ticket 66). The mocks, and later the api from ticket 47, use the shared helper from the contracts package.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The contracts package exports the helper that builds an AI review from a proposal, and the drafted event's check uses it
- [ ] The mocks package uses that helper and keeps no copy of the rule
- [ ] Unit tests in the contracts package cover a proposal with links, Transforms and Transform Links, and an empty proposal
