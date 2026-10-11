import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import { sessionEndpoint, signOutEndpoint } from '@edi-bridge/contracts'
import {
  createSessionStore,
  createWorkspace,
  currentWorkspaceHandler,
  sandboxAdminSession,
  seedSession,
  sessionHandlers,
  showcaseViewerSession,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import type { Session } from '@edi-bridge/contracts'

import preview from '../.storybook/preview'

function signedInAs(session: Session) {
  return [
    ...sessionHandlers(apiUrl, createSessionStore(session)),
    currentWorkspaceHandler(apiUrl, createWorkspace({ name: session.workspace.name })),
  ]
}

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

export const Operator = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `User menu of ${seedSession.user.name}` }),
    )
    await waitFor(() =>
      expect(screen.getByText(`Operator · Admin · ${seedSession.workspace.name}`)).toBeVisible(),
    )
    await expect(screen.getByText(seedSession.user.email)).toHaveClass('break-all')
    await expect(canvas.queryByText('View only')).toBeNull()
  },
})

export const Admin = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(sandboxAdminSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(sandboxAdminSession.workspace.name)).toBeVisible()
    await userEvent.click(
      await canvas.findByRole('button', { name: `User menu of ${sandboxAdminSession.user.name}` }),
    )
    await waitFor(() =>
      expect(screen.getByText(`Admin · ${sandboxAdminSession.workspace.name}`)).toBeVisible(),
    )
    await expect(canvas.queryByText('View only')).toBeNull()
  },
})

export const Viewer = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
    await expect(await canvas.findByText(showcaseViewerSession.workspace.name)).toBeVisible()
  },
})

export const SignsOut = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `User menu of ${seedSession.user.name}` }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})

export const SignOutFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${signOutEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
      ...signedInAs(seedSession),
    )
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `User menu of ${seedSession.user.name}` }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Sign-out failed. Try again.')
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
      ...signedInAs(seedSession),
    )
  },
  async play({ canvas }) {
    const trigger = await canvas.findByRole('button', { name: 'User menu, session unavailable' })

    await expect(trigger).toHaveTextContent('Session unavailable')
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})

export const German = meta.story({
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...signedInAs(seedSession))
  },
  async play({ canvas }) {
    await userEvent.click(
      await canvas.findByRole('button', { name: `Benutzermenü von ${seedSession.user.name}` }),
    )
    await waitFor(() =>
      expect(screen.getByText(`Operator · Admin · ${seedSession.workspace.name}`)).toBeVisible(),
    )
    await expect(screen.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach({ msw }) {
    msw.use(...signedInAs(showcaseViewerSession))
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('View only')).toBeVisible()
    await userEvent.click(
      await canvas.findByRole('button', {
        name: `User menu of ${showcaseViewerSession.user.name}`,
      }),
    )
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeVisible())
  },
})
