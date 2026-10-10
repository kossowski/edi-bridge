# 51: Fast mapping canvas stories

**What to build:** The mapping canvas stories run fast enough on CI that no story comes near its timeout. They decide how long CI takes, and their slowness caused three CI-fix rounds on ticket 12 (about 200 k agent tokens).

On CI run 38073794237 (#29), `web:test` took 107 s, and the three canvas story files took most of it:

| Story file                                       | Tests | Time   |
| ------------------------------------------------ | ----- | ------ |
| `mapping-canvas-screen.stories.tsx`              | 31    | 74.7 s |
| `mapping-canvas-advanced-transforms.stories.tsx` | 17    | 74.6 s |
| `mapping-canvas-transforms.stories.tsx`          | 15    | 69.7 s |

The slowest single stories were Place Lookup Table And Conditional (15.8 s), Transform Nodes (10.7 s), Connect By Mouse (10.1 s) and Place Loop And Jsonata (10.0 s). Each canvas story renders some 250 React Flow nodes and runs axe over about 3,000 elements (`apps/web/vitest.config.ts`). Locally the same stories take 1–2 s. `next build` and `storybook build` run on the same 4-CPU runner at the same time.

Find out where the time goes before changing anything. Candidates: the axe run per story, the size of the seed graph, React Flow layout and measuring, user-event typing delays, and CPU contention with the parallel builds.

**Blocked by:** none

**Status:** needs-triage

- [ ] A profile of one slow canvas story on CI shows how its time splits between render, interactions and axe
- [ ] No canvas story takes more than 5 s on CI
- [ ] The `storybook-canvas` project no longer needs its 30 s test timeout, or the ticket records why it still does
- [ ] Canvas stories still cover the same behaviour and accessibility checks

## Comments
