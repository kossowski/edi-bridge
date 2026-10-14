import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import {
  configDefaults,
  defineConfig,
  type TestProjectInlineConfiguration,
  type TestUserConfig,
} from 'vitest/config'

import SlowTestReporter from '@edi-bridge/vitest-config/slow-test-reporter'

function storybookProject(
  name: string,
  test: TestProjectInlineConfiguration['test'],
): TestProjectInlineConfiguration {
  return {
    extends: true,
    plugins: [storybookTest({ configDir: fileURLToPath(new URL('.storybook', import.meta.url)) })],
    test: {
      name,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
      ...test,
    },
  }
}

const testConfig: TestUserConfig = {
  reporters: [
    ...configDefaults.reporters,
    new SlowTestReporter([
      'components/trading-partners/partner-screen.stories.tsx > Confirmation Arrives',
      'components/document-structures/new-document-structure-screen.stories.tsx > Csv Settings Keep Choices',
    ]),
  ],
  projects: [
    {
      resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
      test: {
        name: 'unit',
        environment: 'node',
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '.next/**'],
      },
    },
    storybookProject('storybook', { exclude: ['**/mapping-canvas-*.stories.tsx'] }),
    // Each canvas story renders some 250 React Flow nodes and runs axe over about 3,000 elements.
    storybookProject('storybook-canvas', {
      // The Storybook plugin adds every story file to `include`, so the rest is excluded here.
      exclude: ['**/!(mapping-canvas-*).stories.tsx', '../../packages/**'],
    }),
  ],
}

if (!process.env.CI) {
  testConfig.maxWorkers = 1
}

export default defineConfig({ test: testConfig })
