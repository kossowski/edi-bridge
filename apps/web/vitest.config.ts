import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type TestUserConfig,
} from 'vitest/config'

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
  projects: [
    {
      test: {
        name: 'unit',
        environment: 'node',
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '.next/**'],
      },
    },
    storybookProject('storybook', { exclude: ['**/mapping-canvas-*.stories.tsx'] }),
    // Each canvas story renders some 250 React Flow nodes and runs axe over about 3,000 elements.
    // That fixed cost is 1-2 s locally but 5-10 s on a shared CI runner, too close to the 15 s
    // default, so only these stories get more time.
    storybookProject('storybook-canvas', {
      // The Storybook plugin adds every story file to `include`, so the rest is excluded here.
      exclude: ['**/!(mapping-canvas-*).stories.tsx', '../../packages/**'],
      testTimeout: 30_000,
    }),
  ],
}

if (!process.env.CI) {
  testConfig.maxWorkers = 1
}

export default defineConfig({ test: testConfig })
