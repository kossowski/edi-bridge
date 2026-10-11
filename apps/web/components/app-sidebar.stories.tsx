import { expect } from 'storybook/test'

import { AppSidebar } from '@/components/app-sidebar'
import { apiUrl } from '@/lib/api/config'
import {
  createSessionStore,
  sandboxAdminSession,
  seedSession,
  sessionHandlers,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Shell/AppSidebar',
  component: AppSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <Story />
      </SidebarProvider>
    ),
  ],
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(seedSession)))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Operator' })).toBeVisible()
    await expect(canvas.getByText('Platform')).toBeVisible()
  },
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(apiUrl, createSessionStore(sandboxAdminSession)))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Operator' })).toBeNull()
    await expect(canvas.queryByText('Platform')).toBeNull()
  },
})
