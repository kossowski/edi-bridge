# 06: Mock stack tracer

**What to build:** One thin, complete path through the prototype stack, using a trivial endpoint (e.g. the current Workspace's name shown in the shell): a Zod contract in a contracts package, an MSW handler with a dummy-data factory in a mocks package, the browser MSW worker in web behind a mock-mode flag, one typed fetch function per endpoint used through TanStack Query, Storybook in web (MSW addon, stories run as Vitest tests with accessibility checks, ui package stories included), and Playwright running against MSW. Storybook is published to GitHub Pages from main.

**Blocked by:** 03 (Dockerfiles, full-stack Compose profile and CI), 05 (App shell)

**Status:** ready-for-agent

- [ ] A contracts package holds the Zod schema of the tracer endpoint; a mocks package holds its handler and a dummy-data factory built from that schema
- [ ] With mock mode on, web shows the mocked value; with mock mode off, web calls the real API URL (no UI code difference between the two)
- [ ] Data fetching goes through one typed function per endpoint and TanStack Query; no server component fetches API data
- [ ] Storybook lives in web, uses the same MSW handlers, includes the ui package's stories, and its stories run as tests with automatic accessibility checks in the Vitest task
- [ ] Playwright runs one test against web in mock mode and is part of CI
- [ ] Storybook is built and published to GitHub Pages on pushes to main
- [ ] A changed contract that the handler no longer satisfies fails the typecheck
