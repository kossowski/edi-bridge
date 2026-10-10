---
name: browser-check
description: 'Check a web change in headless Chromium: every changed page at three widths, with screenshots, axe-core WCAG 2.2 AA checks and ticket-specific interactions. Use as the Browser axis of a review when a diff touches apps/web or packages/ui, or when asked to check a UI change in a browser.'
---

The Browser axis of a review. curl sees only server HTML. This check sees what runs in the browser: layout at each breakpoint, focus, overflow, and interactions. It is a rough check that nothing is broken. It runs in light mode and English only.

It doesn't add committed tests. Ticket 19 adds those once the UX is final.

## Set up

Install the pinned Playwright once per checkout. The skill keeps its own `package.json`, outside the pnpm workspace:

```sh
pnpm --dir .agents/skills/browser-check install --ignore-workspace --frozen-lockfile
```

Playwright 1.63.0 uses Chromium revision 1243 from `~/.cache/ms-playwright`. If the browser is missing, run `pnpm --dir .agents/skills/browser-check exec playwright install chromium`.

The branch under review needs its dependencies installed (`pnpm install` in its worktree).

## 1. Pick the routes

List the pages the diff changes. If the diff touches the shell (`apps/web/app/layout.tsx`, `apps/web/components/app-*`) or `packages/ui`, take every route from `apps/web/lib/navigation.ts`.

For a dynamic route such as `/runs/[id]`, pass concrete URLs. Take the ids from the links on the list page, and pick one per state the ticket changes.

## 2. Run the fixed checks

```sh
node .agents/skills/browser-check/scripts/browser-check.mjs \
	--repo <worktree of the branch> --out <dir outside the repo> --routes /,/runs
```

The script starts `next dev` on a free port with `NEXT_PUBLIC_API_MOCKING=enabled`, so the pages get their data from the mocks package. It stops the server afterwards. Next refuses a second dev server for the same checkout. If one already runs, the script names its URL. Pass that URL with `--base-url` only if the server runs in mock mode (`pnpm --filter @edi-bridge/web dev:mock`). Otherwise run the check against a worktree.

Each page counts as loaded when no element has `aria-busy="true"`. Screens mark their loading state that way. A page that is still busy after 20 seconds becomes an `error` finding, and the script doesn't check its skeleton. For each route it opens 390, 768 and 1440px. It reports:

- an HTTP status other than 2xx
- a page that scrolls sideways
- browser console errors and uncaught exceptions
- axe-core violations against WCAG 2.2 AA, at 1440px

It writes `summary.md`, `summary.json` and one screenshot per width, named `<route>_<width>.png`. It exits with 0 when there are no findings, 1 when there are findings, and 2 on a usage error or when the dev server doesn't start. Pass `--base-url` to check a server that is already running.

## 3. Check the ticket's behaviour

For each acceptance criterion with visible behaviour, write a short script in your scratch directory. Import the helpers by absolute path, so that Playwright resolves from this skill:

```js
import { gotoSettled, launchBrowser, openPage, startDevServer } from '<repo>/.agents/skills/browser-check/scripts/lib.mjs'

const server = await startDevServer('<worktree>')
let browser
try {
	browser = await launchBrowser()
	const { page } = await openPage(browser, { baseUrl: server.baseUrl, width: 390 })
	await gotoSettled(page, server.baseUrl + '/runs', 'light')
	// interact and assert
} finally {
	await browser?.close()
	await server.stop()
}
```

`gotoSettled` waits for the theme and for the page to load, the same way the fixed checks do. `startDevServer` starts the server in mock mode. `lib.mjs` also exports `hasHorizontalOverflow(page)` and the `widths` list.

- Find elements by role and accessible name, in English.
- Keep the output quiet: print one `pass` or `fail` line per criterion. Print details such as the DOM, the console log or values only for a failing step.
- Reload the page before you test the Tab order. After a click, Tab continues from the clicked element.
- To find leftover servers, use `pgrep -af "[n]ext dev --port"`. Without the brackets, the pattern matches its own shell.

## 4. Look at the screenshots

There are 3 screenshots per route, one per width. Open them for the changed routes. Look for clipped or overlapping text, broken layout, missing focus rings and low contrast. To see focus rings, take a screenshot after pressing Tab in a step 3 script.

## Report

Stay under 400 words. List each finding with where it occurs (route, width), what is wrong, and the evidence (a screenshot path or the failing step). Mark findings from step 2 and failed criteria from step 3 as hard. Mark visual judgements from step 4 as judgement calls. If there are no findings, say which routes and criteria you checked.

## Limits

- The check runs against `next dev`, not a production build.
- Pages get mock data, not data from `apps/api`.
- The script can't tell that a screen has loaded if the screen doesn't set `aria-busy` while it loads. It then checks the loading state.
