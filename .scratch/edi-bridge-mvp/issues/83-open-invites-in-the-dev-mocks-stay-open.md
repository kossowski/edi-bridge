# 83: Open invites in the dev mocks stay open

**What to build:** The dev mocks always show an open invite, whatever the date. The seeded open invite was created on 2026-10-08 and expires on 2026-10-15, after which the Members tab and the operator area show no open invites (ticket 70).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The seeded open invite is dated relative to now, so it stays open
- [ ] One seeded invite is expired, so the expired state stays visible
- [ ] Tests that check invite states don't depend on today's date
