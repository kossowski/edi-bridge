import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { HeaderTabs, headerTabsId } from '@/components/header-tabs'
import { sessionHandlers } from '@/components/session/session-story-helpers'
import { besideSidebar, darkMode, german, mobile, tablet } from '@/components/story-helpers'
import { everyKind } from '@/components/tasks/task-story-helpers'
import { useBreadcrumbName } from '@/hooks/use-breadcrumb-name'
import { apiUrl } from '@/lib/api/config'
import {
  sandboxAdminSession,
  seedSession,
  showcaseViewerSession,
  tasksHandler,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@edi-bridge/ui/components/tabs'

import preview from '../.storybook/preview'

function NamedPage({ name }: { name: string }) {
  useBreadcrumbName(name)

  return <div className="p-4">{name}</div>
}

function PageWithTabs() {
  return (
    <Tabs defaultValue="details" className="p-4">
      <HeaderTabs>
        <TabsList variant="line">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="routes">Document routes</TabsTrigger>
        </TabsList>
      </HeaderTabs>
      <TabsContent value="details">Details of the trading partner</TabsContent>
      <TabsContent value="connections">Connections of the trading partner</TabsContent>
      <TabsContent value="routes">Document routes of the trading partner</TabsContent>
    </Tabs>
  )
}

function tabRow(canvasElement: HTMLElement) {
  return canvasElement.querySelector(`#${headerTabsId}`)
}

function headerActions(canvasElement: HTMLElement) {
  return canvasElement.querySelector('[data-slot="header-actions"]')
}

const meta = preview.meta({
  title: 'Shell/AppHeader',
  component: AppHeader,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/' } } },
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
    msw.use(...sessionHandlers(sandboxAdminSession), tasksHandler(apiUrl, everyKind()))
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: /Account menu|Language|Color theme/ }),
    ).toBeNull()
    await expect(canvas.queryByText('View only')).toBeNull()
    await expect(canvas.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(tabRow(canvasElement)).not.toBeVisible()
    await expect(headerActions(canvasElement)).toContainElement(
      canvas.getByRole('button', { name: 'Search orders, partners, documents, pages…' }),
    )
    await expect(headerActions(canvasElement)).toContainElement(
      await canvas.findByRole('button', { name: 'Tasks, 5 open' }),
    )
  },
})

export const Operator = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/operator/workspaces/ws-1' } } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('button', { name: 'Toggle sidebar' })).toBeVisible()
    await expect(canvas.queryByText('View only')).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Operator area' })).toHaveAttribute(
      'href',
      '/operator',
    )
  },
})

export const Section = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/lookup-tables' } } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Code translations' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
})

export const DetailWithoutName = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/trading-partners/tp-1' } } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Trading partners' })).toHaveAttribute(
      'href',
      '/trading-partners',
    )
    await expect(canvas.getByRole('link', { name: 'Details' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(canvas.queryByText('tp-1')).toBeNull()
  },
})

export const DetailWithName = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/trading-partners/tp-1' } } },
  render: () => (
    <>
      <AppHeader />
      <NamedPage name="Nordwind Handel GmbH" />
    </>
  ),
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Nordwind Handel GmbH' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
})

export const NewPage = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/channels/new' } } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'All connections' })).toHaveAttribute(
      'href',
      '/channels',
    )
    await expect(canvas.getByRole('link', { name: 'New' })).toHaveAttribute('aria-current', 'page')
  },
})

export const EditPage = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/flows/flow-1/edit' } } },
  render: () => (
    <>
      <AppHeader />
      <NamedPage name="Orders from Nordwind" />
    </>
  ),
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Orders from Nordwind' })).toHaveAttribute(
      'href',
      '/flows/flow-1',
    )
    await expect(canvas.getByRole('link', { name: 'All document routes' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Edit' })).toHaveAttribute('aria-current', 'page')
  },
})

export const WithTabs = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/trading-partners/tp-1' } } },
  render: () => (
    <>
      <AppHeader />
      <PageWithTabs />
    </>
  ),
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas, canvasElement }) {
    const connections = await canvas.findByRole('tab', { name: 'Connections' })

    await expect(tabRow(canvasElement)).toBeVisible()
    await expect(tabRow(canvasElement)).toContainElement(connections)
    await userEvent.click(connections)
    await expect(canvas.getByText('Connections of the trading partner')).toBeVisible()
  },
})

export const Search = meta.story({
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    const search = await canvas.findByRole('button', {
      name: 'Search orders, partners, documents, pages…',
    })

    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', { name: 'Search' })

    await waitFor(() => expect(dialog).toBeVisible())
    await expect(
      await within(dialog).findByRole('group', { name: 'Trading partners' }),
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(search)
    await expect(await screen.findByRole('dialog', { name: 'Search' })).toBeInTheDocument()
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
  parameters: { nextjs: { navigation: { pathname: '/mappings/m-1/versions' } } },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession), tasksHandler(apiUrl, 'empty'))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Nur ansehen')).toBeVisible()
    await expect(
      await canvas.findByRole('button', { name: 'Aufgaben, nichts offen' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Aufträge, Handelspartner, Belege, Seiten suchen …' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Seitenleiste ein- oder ausblenden' }),
    ).toBeVisible()
    await expect(canvas.getByRole('navigation', { name: 'Navigationspfad' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Details' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Versionen' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
})

export const Dark = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/trading-partners/tp-1' } } },
  render: () => (
    <>
      <AppHeader />
      <PageWithTabs />
    </>
  ),
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
    await expect(await canvas.findByRole('tab', { name: 'Details' })).toBeVisible()
  },
})

export const Tablet = meta.story({
  ...tablet,
  decorators: [besideSidebar],
  parameters: {
    ...tablet.parameters,
    nextjs: { navigation: { pathname: '/mappings/m-1/versions/compare' } },
  },
  render: () => (
    <>
      <AppHeader />
      <NamedPage name="Purchase orders from Nordwind Handel GmbH to the warehouse system" />
    </>
  ),
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Compare' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Search orders, partners, documents, pages…' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Mappings' })).toBeNull()
    await expect(canvas.queryByRole('link', { name: 'Versions' })).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Show the whole path' }))
    await waitFor(async () =>
      expect(
        await screen.findByRole('menuitem', {
          name: 'Purchase orders from Nordwind Handel GmbH to the warehouse system',
        }),
      ).toBeVisible(),
    )
    await expect(screen.getByRole('menuitem', { name: 'Versions' })).toBeVisible()
    await expect(screen.getByRole('menuitem', { name: 'Mappings' })).toBeVisible()
  },
})

export const Mobile = meta.story({
  ...mobile,
  parameters: {
    ...mobile.parameters,
    nextjs: { navigation: { pathname: '/channels/ch-1/edit' } },
  },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Edit' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(canvas.queryByRole('link', { name: 'All connections' })).toBeNull()
    await expect(
      canvas.getByRole('button', { name: 'Search orders, partners, documents, pages…' }),
    ).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Show the whole path' }))
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: 'Details' })).toBeVisible(),
    )
    await expect(screen.getByRole('menuitem', { name: 'All connections' })).toBeVisible()
  },
})
