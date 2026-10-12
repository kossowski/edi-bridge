import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import type { ReactNode } from 'react'

import { AccountMenu } from '@/components/session/account-menu'
import { accountMenuOf, sessionHandlers } from '@/components/session/session-story-helpers'
import { darkMode, german, mobile, withSidebarProvider } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import { sessionEndpoint, signOutEndpoint } from '@edi-bridge/contracts'
import { sandboxAdminSession, seedSession, showcaseViewerSession } from '@edi-bridge/mocks'
import { Sidebar, SidebarFooter } from '@edi-bridge/ui/components/sidebar'

import preview from '../../.storybook/preview'

function inSidebarFooter(Story: () => ReactNode) {
  return (
    <Sidebar collapsible="icon" label="Main navigation">
      <SidebarFooter className="mt-auto">
        <Story />
      </SidebarFooter>
    </Sidebar>
  )
}

async function openMenu(name: (accessibleName: string) => boolean) {
  await userEvent.click(await screen.findByRole('button', { name }))

  return screen.findByRole('menu')
}

const meta = preview.meta({
  title: 'Shell/AccountMenu',
  component: AccountMenu,
  parameters: { layout: 'fullscreen' },
  decorators: [inSidebarFooter, withSidebarProvider],
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play() {
    const menu = await openMenu(accountMenuOf(sandboxAdminSession.user.name))

    await expect(menu).toHaveTextContent(`Workspace: ${sandboxAdminSession.workspace.name}`)
    await expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
    await expect(screen.queryByRole('menuitem', { name: 'Operator area' })).toBeNull()
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: /Language/ })).toBeVisible(),
    )
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: /Color theme/ })).toBeVisible(),
    )
  },
})

export const Viewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))
  },
  async play() {
    const trigger = await screen.findByRole('button', {
      name: accountMenuOf(showcaseViewerSession.user.name),
    })

    await expect(trigger).toHaveTextContent('Viewer')
    await userEvent.click(trigger)
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible(),
    )
  },
})

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play() {
    const trigger = await screen.findByRole('button', {
      name: accountMenuOf(seedSession.user.name),
    })

    await expect(trigger).toHaveTextContent('Operator · Admin')
    await userEvent.click(trigger)
    await expect(await screen.findByRole('menuitem', { name: 'Operator area' })).toHaveAttribute(
      'href',
      '/operator',
    )
  },
})

export const ThemeChoice = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play() {
    await openMenu(accountMenuOf(sandboxAdminSession.user.name))
    await userEvent.click(screen.getByRole('menuitem', { name: /Color theme/ }))
    await waitFor(async () =>
      expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toBeVisible(),
    )
    await expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked()
  },
})

export const SignsOut = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play() {
    await openMenu(accountMenuOf(seedSession.user.name))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})

export const SignOutFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${signOutEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
      ...sessionHandlers(seedSession),
    )
  },
  async play() {
    await openMenu(accountMenuOf(seedSession.user.name))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out failed. Try again.')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await expect(getRouter().replace).not.toHaveBeenCalled()
  },
})

export const SessionUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${sessionEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play() {
    const menu = await openMenu(accountMenuOf('Session unavailable'))

    await expect(menu).toHaveTextContent('You can still sign out.')
    await expect(screen.queryByRole('menuitem', { name: 'Settings' })).toBeNull()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})

export const Collapsed = meta.story({
  parameters: { sidebarOpen: false },
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play() {
    await openMenu(accountMenuOf(seedSession.user.name))
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Operator area' })).toBeVisible(),
    )
  },
})

export const Mobile = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(sandboxAdminSession))
  },
  async play({ canvas }) {
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle sidebar' }))
    await openMenu(accountMenuOf(sandboxAdminSession.user.name))
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeVisible(),
    )
  },
})

export const German = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(seedSession))
  },
  async play() {
    const menu = await openMenu(accountMenuOf(seedSession.user.name, 'Kontomenü'))

    await expect(menu).toHaveTextContent(`Arbeitsbereich: ${seedSession.workspace.name}`)
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Einstellungen' })).toBeVisible(),
    )
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Operator-Bereich' })).toBeVisible(),
    )
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: /Sprache/ })).toBeVisible(),
    )
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible(),
    )
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...sessionHandlers(showcaseViewerSession))

    return darkMode()
  },
  async play() {
    await openMenu(accountMenuOf(showcaseViewerSession.user.name))
    await waitFor(async () =>
      expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeVisible(),
    )
  },
})
