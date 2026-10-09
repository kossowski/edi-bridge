import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

import { chromium } from 'playwright'

export const widths = [390, 768, 1024, 1440]
export const themes = ['light', 'dark']
export const locales = ['en', 'de']

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

export async function startDevServer(repo, { timeoutMs = 120_000 } = {}) {
  const port = await freePort()
  const child = spawn(
    'pnpm',
    ['--filter', '@edi-bridge/web', 'exec', 'next', 'dev', '--port', String(port)],
    {
      cwd: repo,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // apps/api doesn't serve the screens' endpoints yet, so the pages get their data from MSW.
      env: { ...process.env, NEXT_PUBLIC_API_MOCKING: 'enabled' },
    },
  )
  let log = ''
  child.stdout.on('data', (chunk) => (log += chunk))
  child.stderr.on('data', (chunk) => (log += chunk))

  const baseUrl = `http://localhost:${port}`
  // next dev forks workers that outlive pnpm, so signal and wait for the whole process group.
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal)
      return true
    } catch {
      return false
    }
  }
  // Node skips finally blocks on a signal, and the detached group doesn't receive the terminal's signal.
  const onSignal = async (signal) => {
    await stop()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const stop = async () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    signalGroup('SIGTERM')
    const killAt = Date.now() + 5000
    while (signalGroup(0)) {
      if (Date.now() > killAt) signalGroup('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await stop()
      // Next refuses a second dev server for the same app directory.
      const running = log.match(/Another next dev server is already running[\s\S]*?Local:\s+(\S+)/)
      if (running) {
        throw new Error(
          `A next dev server already runs for ${repo} at ${running[1]}. ` +
            `Pass --base-url ${running[1]} if it runs with NEXT_PUBLIC_API_MOCKING=enabled, ` +
            `or run the check against a worktree.`,
        )
      }
      throw new Error(`next dev exited with code ${child.exitCode}:\n${log}`)
    }
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)) })
      return { baseUrl, stop, log: () => log }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  await stop()
  throw new Error(`next dev did not answer on ${baseUrl} within ${timeoutMs} ms:\n${log}`)
}

// Playwright's own SIGINT handler exits before startDevServer's handler has stopped the server.
export function launchBrowser() {
  return chromium.launch({ handleSIGHUP: false, handleSIGINT: false, handleSIGTERM: false })
}

export async function openPage(browser, { baseUrl, width = 1440, height = 900, theme = 'light', locale = 'en' }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: baseUrl }])
  await context.addInitScript((value) => localStorage.setItem('theme', value), theme)

  const page = await context.newPage()
  page.setDefaultNavigationTimeout(90_000)
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  return { context, page, consoleErrors }
}

export async function gotoSettled(page, url, theme, { timeoutMs = 20_000 } = {}) {
  const response = await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme)
  // Mock data arrives after the load event. Screens mark their loading state with aria-busy.
  try {
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, {
      timeout: timeoutMs,
    })
  } catch {
    throw new Error(`page still loading after ${timeoutMs} ms: an element keeps aria-busy="true"`)
  }
  return response
}

export function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}
