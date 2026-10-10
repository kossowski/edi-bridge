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
    // Side by side on one CI runner, these files took 10-15 s per story, so the `test:canvas`
    // task runs them on their own and CI shards them across runners.
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
