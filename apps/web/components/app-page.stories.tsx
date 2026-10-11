import { expect } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { AppPage } from '@/components/app-page'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, mobile } from '@/components/story-helpers'
import { sandboxAdminSession } from '@edi-bridge/mocks'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../.storybook/preview'

const meta = preview.meta({
  title: 'Shell/AppPage',
  component: AppPage,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Trading partners',
    children: <p className="rounded-lg border p-4 text-sm">Content of the page</p>,
  },
})

const pageMeta = (
  <>
    <Badge variant="secondary">Active</Badge>
    <span>GLN 4012345000009</span>
    <span>Updated 12 Oct 2026, 09:14</span>
  </>
)

const pageActions = (
  <>
    <Button variant="outline">Export</Button>
    <Button>New trading partner</Button>
  </>
)

export const TitleOnly = meta.story({
  async play({ canvas }) {
    const heading = canvas.getByRole('heading', { level: 1, name: 'Trading partners' })

    await expect(heading).toHaveClass('sr-only')
    await expect(canvas.getByText('Content of the page')).toBeVisible()
  },
})

export const WithMeta = meta.story({
  args: { meta: pageMeta },
  async play({ canvas }) {
    await expect(canvas.getByText('GLN 4012345000009')).toBeVisible()
  },
})

export const WithActions = meta.story({
  args: { actions: pageActions },
  async play({ canvas }) {
    await expect(canvas.getByRole('button', { name: 'New trading partner' })).toBeVisible()
  },
})

export const MetaAndActions = meta.story({
  args: { meta: pageMeta, actions: pageActions },
  async play({ canvas }) {
    await expect(canvas.getByText('GLN 4012345000009')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Export' })).toBeVisible()
  },
})

export const NamesTheBreadcrumb = meta.story({
  args: { title: 'Nordwind Handel GmbH', name: 'Nordwind Handel GmbH', meta: pageMeta },
  parameters: { nextjs: { navigation: { pathname: '/trading-partners/tp-1' } } },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex w-full flex-col">
          <AppHeader />
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Nordwind Handel GmbH' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  },
})

export const Dark = meta.story({
  args: { meta: pageMeta, actions: pageActions },
  beforeEach: darkMode,
})

export const Mobile = meta.story({
  ...mobile,
  args: { meta: pageMeta, actions: pageActions },
})
