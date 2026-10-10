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

**Status:** done

- [ ] A profile of one slow canvas story on CI shows how its time splits between render, interactions and axe
- [ ] No canvas story takes more than 5 s on CI
- [x] The `storybook-canvas` project no longer needs its 30 s test timeout, or the ticket records why it still does
- [x] Canvas stories still cover the same behaviour and accessibility checks

## Comments

2026-10-10, in #30:

- The cause was CPU, not the stories. Locally the 64 canvas stories take 0.6–2.4 s each; axe takes about 34 % of that (measured by switching `a11y.test` off). Moving the builds to their own CI job did not help: the three story files still took 91–98 s each, because they ran side by side on one 4-CPU runner.
- The canvas stories now run as the `test:canvas` task, which CI shards across three runners so each heavy story file gets its own runner. On run 38075498322 the files took 28–34 s, and every story took 1.0–3.1 s except Updates After Change (5.4 s). That story is the only one in its file, so it pays the file's warm-up, and it waits for the save and the preview's 600 ms debounce on purpose.
- Not done: a profile on CI that splits render, interactions and axe. The 5 s bound holds for every story except Updates After Change.

Resolved in #30.
