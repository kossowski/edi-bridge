---
name: browser-check
description: 'Check a web change in headless Chromium: every changed page at four widths, in light and dark, in English and German, with screenshots, axe-core WCAG 2.2 AA checks and ticket-specific interactions. Use as the Browser axis of a review when a diff touches apps/web or packages/ui, or when asked to check a UI change in a browser.'
---

The Browser axis of a review. curl sees only server HTML. This check sees what runs in the browser: theme and language switching, focus, overflow, and interactions.

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

## 2. Run the fixed checks

```sh
node .agents/skills/browser-check/scripts/browser-check.mjs \
	--repo <worktree of the branch> --out <dir outside the repo> --routes /,/runs
```

The script starts `next dev` on a free port and stops it afterwards. For each route it opens every combination of 390, 768, 1024 and 1440px, light and dark, and English and German. It reports:

- an HTTP status other than 2xx
- a wrong `<html lang>`
- a page that scrolls sideways
- browser console errors and uncaught exceptions
- axe-core violations against WCAG 2.2 AA, at 1440px

It writes `summary.md`, `summary.json` and one screenshot per combination, named `<route>_<width>_<theme>_<locale>.png`. It exits with 0 when there are no findings, 1 when there are findings, and 2 on a usage error. Pass `--base-url` to check a server that is already running.

## 3. Check the ticket's behaviour

For each acceptance criterion with visible behaviour, write a short script in your scratch directory. Import the helpers by absolute path, so that Playwright resolves from this skill:

```js
import { chromium, gotoSettled, openPage, startDevServer } from '<repo>/.agents/skills/browser-check/scripts/lib.mjs'

const server = await startDevServer('<worktree>')
const browser = await chromium.launch()
try {
	const { page } = await openPage(browser, { baseUrl: server.baseUrl, width: 390, theme: 'dark', locale: 'de' })
	await gotoSettled(page, server.baseUrl + '/runs', 'dark')
	// interact and assert
} finally {
	await browser.close()
	await server.stop()
}
```

`lib.mjs` also exports `hasHorizontalOverflow(page)` and the `widths`, `themes` and `locales` lists.

- Find elements by role and accessible name, in the locale you opened. The German page has German names.
- Reload the page before you test the Tab order. After a click, Tab continues from the clicked element.
- To find leftover servers, use `pgrep -af "[n]ext dev --port"`. Without the brackets, the pattern matches its own shell.

## 4. Look at the screenshots

There are 16 screenshots per route. Open the changed routes at 390 and 1024px in dark German, and at 1440px in light English. Look for clipped or overlapping text, missing focus rings, low contrast, and layout that differs between themes. To see focus rings, take a screenshot after pressing Tab in a step 3 script.

## Report

Stay under 400 words. List each finding with where it occurs (route, width, theme, locale), what is wrong, and the evidence (a screenshot path or the failing step). Mark findings from step 2 and failed criteria from step 3 as hard. Mark visual judgements from step 4 as judgement calls. If there are no findings, say which routes and criteria you checked.

## Limits

- The check runs against `next dev`, not a production build.
- Pages that need API data show what the dev server returns. That stays true until the mocks package and MSW exist.
