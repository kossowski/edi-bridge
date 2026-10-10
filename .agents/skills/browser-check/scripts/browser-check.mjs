import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { AxeBuilder } from '@axe-core/playwright'

import {
  gotoSettled,
  hasHorizontalOverflow,
  launchBrowser,
  openPage,
  startDevServer,
  widths,
} from './lib.mjs'

const usage = `Usage: node browser-check.mjs --routes /,/runs --out <dir> [--repo <path>] [--base-url <url>]`

const { values } = parseArgs({
  options: {
    routes: { type: 'string' },
    out: { type: 'string' },
    repo: { type: 'string' },
    'base-url': { type: 'string' },
  },
})
if (!values.routes || !values.out) {
  console.error(usage)
  process.exit(2)
}

const routes = values.routes.split(',').map((route) => route.trim())
const out = resolve(values.out)
const screenshots = join(out, 'screenshots')
mkdirSync(screenshots, { recursive: true })

const repo = () =>
  values.repo ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
let server = null
if (!values['base-url']) {
  try {
    server = await startDevServer(repo())
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
}
const baseUrl = values['base-url'] ?? server.baseUrl

const slug = (route) => (route === '/' ? 'root' : route.replace(/^\//, '').replaceAll('/', '_'))
const findings = []
const shots = []

let browser
try {
  browser = await launchBrowser()
  for (const route of routes) {
    for (const width of widths) {
      const { context, page, consoleErrors } = await openPage(browser, { baseUrl, width })
      const where = `${route} @ ${width}px`
      try {
        const response = await gotoSettled(page, baseUrl + route, 'light')
        if (!response?.ok()) findings.push({ kind: 'http', where, detail: `status ${response?.status()}` })

        if (await hasHorizontalOverflow(page)) {
          findings.push({ kind: 'overflow', where, detail: 'page scrolls sideways' })
        }

        const file = join(screenshots, `${slug(route)}_${width}.png`)
        await page.screenshot({ path: file, fullPage: true })
        shots.push(file)

        if (width === 1440) {
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze()
          for (const violation of axe.violations) {
            findings.push({
              kind: 'axe',
              where,
              detail: `${violation.id} (${violation.impact}): ${violation.help}; ${violation.nodes.length} node(s), first: ${violation.nodes[0]?.target.join(' ')}`,
            })
          }
        }
      } catch (error) {
        findings.push({ kind: 'error', where, detail: error.message.split('\n')[0] })
      }
      for (const message of consoleErrors) findings.push({ kind: 'console', where, detail: message })
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await server?.stop()
}

const lines = [
  `Browser check: ${routes.length} route(s), ${shots.length} screenshot(s) in ${screenshots}`,
  findings.length === 0 ? 'No findings.' : `${findings.length} finding(s):`,
  ...findings.map(({ kind, where, detail }) => `- [${kind}] ${where}: ${detail}`),
]
writeFileSync(join(out, 'summary.json'), JSON.stringify({ baseUrl, routes, findings, shots }, null, 2))
writeFileSync(join(out, 'summary.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
process.exitCode = findings.length === 0 ? 0 : 1
