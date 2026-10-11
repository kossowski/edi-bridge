import { expect } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, german } from '@/components/story-helpers'
import { sandboxAdminSession, seedSession, showcaseViewerSession } from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Shell/AppHeader',
  component: AppHeader,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="w-full">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: /Account menu|Language|Color theme/ }),
    ).toBeNull()
    await expect(canvas.queryByText('View only')).toBeNull()
  },
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
    await expect(canvas.queryByText('View only')).toBeNull()
  },
})

export const Viewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Nur ansehen')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Seitenleiste ein- oder ausblenden' }),
    ).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
  },
})
