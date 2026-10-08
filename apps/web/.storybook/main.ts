import { defineMain } from '@storybook/nextjs-vite/node'

export default defineMain({
  framework: '@storybook/nextjs-vite',
  stories: ['../components/**/*.stories.tsx', '../../../packages/ui/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest', 'msw-storybook-addon'],
  staticDirs: ['../public'],
})
