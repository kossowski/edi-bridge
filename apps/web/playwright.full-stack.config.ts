import { defineConfig, devices } from '@playwright/test'

const webPort = process.env.WEB_PORT ?? '3000'

const config = defineConfig({
  testDir: './e2e-full-stack',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})

export default config
