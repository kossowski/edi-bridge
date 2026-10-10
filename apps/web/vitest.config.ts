import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { defineConfig, type TestUserConfig } from 'vitest/config'

const testConfig: TestUserConfig = {
  projects: [
    {
      test: {
        name: 'unit',
        environment: 'node',
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '.next/**'],
      },
    },
    {
      extends: true,
      plugins: [
        storybookTest({ configDir: fileURLToPath(new URL('.storybook', import.meta.url)) }),
      ],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: [{ browser: 'chromium' }],
        },
      },
    },
  ],
}

if (!process.env.CI) {
  testConfig.maxWorkers = 1
}

export default defineConfig({ test: testConfig })
