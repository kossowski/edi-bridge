import { expect, screen, userEvent, waitFor } from 'storybook/test'

import type { ReactNode } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { accountMenuOf, sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createWorkspace,
  currentWorkspaceHandler,
  sandboxAdminSession,
  seedSession,
  showcaseViewerSession,
} from '@edi-bridge/mocks'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@edi-bridge/ui/components/sidebar'

import type { Session } from '@edi-bridge/contracts'

import preview from '../.storybook/preview'

function signedInAs(session: Session) {
  return [
    ...sessionHandlers(session),
    currentWorkspaceHandler(apiUrl, createWorkspace({ name: session.workspace.name })),
  ]
}

function withSidebarProvider(
  Story: () => ReactNode,
  { parameters }: { parameters: { sidebarOpen?: boolean } },
) {
  return (
    <SidebarProvider defaultOpen={parameters.sidebarOpen ?? true}>
      <Story />
      <SidebarInset>
        <div className="p-4">
          <SidebarTrigger label="Toggle sidebar" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

const meta = preview.meta({
  title: 'Shell/AppSidebar',
  component: AppSidebar,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/' } } },
  decorators: [withSidebarProvider],
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(sandboxAdminSession.workspace.name)).toBeVisible()
    await expect(canvas.getByText('Daily work')).toBeVisible()
    await expect(canvas.getByText('Setup')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(canvas.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/runs')
    await expect(canvas.getByRole('link', { name: 'Code translations' })).toHaveAttribute(
      'href',
      '/lookup-tables',
    )
    await expect(canvas.queryByRole('link', { name: 'Settings' })).toBeNull()
    await expect(
      await canvas.findByRole('button', {
        name: accountMenuOf(sandboxAdminSession.user.name),
      }),
    ).toBeVisible()
  },
})

export const Viewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(showcaseViewerSession.workspace.name)).toBeVisible()
    await expect(
      await canvas.findByRole('button', {
        name: accountMenuOf(showcaseViewerSession.user.name),
      }),
    ).toHaveTextContent('Viewer')
  },
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(seedSession.workspace.name)).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'Operator' })).toBeNull()
    await userEvent.click(
      await canvas.findByRole('button', { name: accountMenuOf(seedSession.user.name) }),
    )
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: 'Operator area' })).toBeVisible(),
    )
  },
})

export const AdvancedExpands = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    const advanced = await canvas.findByRole('button', { name: 'Advanced' })

    await expect(advanced).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('link', { name: 'All connections' })).toBeNull()
    await userEvent.click(advanced)
    await expect(await canvas.findByRole('link', { name: 'All connections' })).toHaveAttribute(
      'href',
      '/channels',
    )
    await expect(canvas.getByRole('link', { name: 'All document routes' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Transmissions' })).toBeVisible()
  },
})

export const AdvancedOpenOnItsPage = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/flows/flow-1' } } },
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'All document routes' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
})

export const DocumentsActiveOnce = meta.story({
  parameters: { nextjs: { navigation: { pathname: '/runs' } } },
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'Documents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Advanced' }))
    await expect(await canvas.findByRole('link', { name: 'Transmissions' })).not.toHaveAttribute(
      'aria-current',
    )
  },
})

export const Collapsed = meta.story({
  parameters: { sidebarOpen: false },
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: 'All connections' })).toBeInTheDocument()
    await userEvent.hover(canvas.getByRole('link', { name: 'Documents' }))
    await waitFor(async () =>
      expect(await screen.findByText('Documents: Every document received or sent')).toBeVisible(),
    )
    await userEvent.click(
      await canvas.findByRole('button', { name: accountMenuOf(seedSession.user.name) }),
    )
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible(),
    )
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle sidebar' }))
    await waitFor(async () =>
      expect(await screen.findByText(sandboxAdminSession.workspace.name)).toBeVisible(),
    )
    await userEvent.click(
      await screen.findByRole('button', {
        name: accountMenuOf(sandboxAdminSession.user.name),
      }),
    )
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeVisible(),
    )
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Tagesgeschäft')).toBeVisible()
    await expect(canvas.getByText('Einrichtung')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Erweitert' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Belege' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Ihre Datenformate' })).toBeVisible()
    await waitFor(() =>
      expect(
        canvas.getByRole('button', { name: accountMenuOf(seedSession.user.name, 'Kontomenü') }),
      ).toBeVisible(),
    )
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))

    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(showcaseViewerSession.workspace.name)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Advanced' }))
    await expect(await canvas.findByRole('link', { name: 'Transmissions' })).toBeVisible()
  },
})
