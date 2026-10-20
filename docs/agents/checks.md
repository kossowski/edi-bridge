# Checks

What the `developer`, `ticket-lead` and `browser-check` skills run, check and skip in this repo.

## Verify command

The developer runs it once before reporting, through the slot script:

```bash
pnpm -C <worktree> turbo run check-types test --filter='...[<parent>]'
```

It type-checks and unit-tests the packages changed since `<parent>` and every package that depends on them. The `apps/api` and `packages/db` tests start Postgres with Testcontainers, so Docker must run.

## Left to CI and the hooks

- CI runs every task on each PR: `lint`, `check-types`, `test`, `test:stories`, `test:canvas`, `test:e2e`, `build`, `build-storybook`, and `test:e2e:full-stack` against the `full-stack` Compose profile in a job of its own (`.github/workflows/ci.yml`). Run one of these locally only to reproduce a failed CI task.
- The pre-commit hook runs lint-staged: `oxlint --fix` and `oxfmt` on the staged files.
- The `agent-hooks` CI job tests the Claude Code hooks in `.claude/hooks/`. After a change there, run `pnpm test:agent-hooks` locally: the verify command leaves these hooks out.

## UI parts

A part is **UI** when it changes what renders: components, routes, styles or i18n messages in `apps/web` or `packages/ui`. It gets a browser check.

A change to the shell (`apps/web/app/layout.tsx`, `apps/web/components/app-*`) or to `packages/ui` checks every route in `apps/web/lib/navigation.ts`.

## Browser check server

The browser-check scripts read `.agents/project.env`: they start `next dev` of `WEB_PACKAGE` with `WEB_DEV_ENV`. Here that is `@edi-bridge/web` with `NEXT_PUBLIC_API_MOCKING=enabled`, so the pages get their data from the MSW handlers in `packages/mocks`, not from `apps/api`. The mocks cover screens whose endpoints `apps/api` doesn't serve yet. The same server by hand: `pnpm --filter @edi-bridge/web dev:mock`. `DEV_PORTS` lists the ports `stop-leftovers.sh` checks: Next on 3000, Storybook on 6006.

## Skipping review

- **Generated files**, left out of a part's line count: `pnpm-lock.yaml`, `packages/db/migrations/`, `apps/web/public/mockServiceWorker.js`. Count with:

  ```bash
  git -C <worktree> diff --shortstat <parent>...HEAD -- . ':(exclude)pnpm-lock.yaml' ':(exclude)packages/db/migrations' ':(exclude)apps/web/public/mockServiceWorker.js'
  ```

- **CI-only files**: anything under `.github/` or `.husky/`, and the root configs `turbo.json`, `.oxfmtrc.json`, `lint-staged.config.mjs`, `commitlint.config.mjs`, `.gitattributes`, `.gitignore`, `.dockerignore` and `skills-lock.json`.

## Parallel parts

The typical split: part 1 in `packages/contracts`, then an `apps/api` part and an `apps/web` part. The web part builds against the MSW handlers in `packages/mocks`, so it runs in parallel with the api part.
