# 52: Faster CI runs

**What to build:** CI runs only the tasks a PR affects, starts with a filled Turbo cache, and runs its heavy tasks in parallel jobs.

Today every PR runs all 22 tasks. `turbo run --affected` reads the base branch from `GITHUB_BASE_REF`, but `actions/checkout` creates only `origin/<branch>`, so Turbo logs `Failed to resolve base ref 'main'` and assumes that every file changed. This hits PRs into `main` and stacked PRs alike. The Turbo cache rarely helps either: CI runs only on `pull_request`, and a PR can read caches only from its own branch and from `main`, so every new branch starts cold (`0 cached, 22 total`). Each run also downloads Chromium again (about 22 s).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `--affected` resolves the PR's base branch, for PRs into `main` and for stacked PRs, without the `TURBO_SCM_BASE` warning
- [ ] CI runs on pushes to `main`, so new branches restore a Turbo cache saved on `main`
- [ ] The Playwright Chromium download is cached by Playwright version
- [ ] Lint and types, tests, builds and e2e run as parallel jobs, so story tests don't share CPU with the builds; the required check keeps its name

## Comments
