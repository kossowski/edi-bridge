# 49: Browser check waits for loaded pages

**What to build:** The browser-check skill checks pages after their mock data has loaded. Today it takes screenshots, measures overflow and runs axe on the loading skeleton, and it starts `next dev` without mock data. In the review of ticket 08 it missed a Mapping Version select that made the page scroll sideways at 390px.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `gotoSettled` waits until no element has `aria-busy="true"`, and a page that stays busy becomes a finding instead of a check of the skeleton
- [ ] The script starts `next dev` with `NEXT_PUBLIC_API_MOCKING=enabled`
- [ ] When a dev server already runs for the checkout, the script names its URL and points to `--base-url` or a worktree
- [ ] `SKILL.md` describes mock mode, the loading marker and concrete URLs for dynamic routes
