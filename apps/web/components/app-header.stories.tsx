import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { apiUrl } from '@/lib/api/config'
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
      await canvas.findByRole('button', { name: `Account of ${seedSession.user.name}` }),
    )
    await waitFor(() =>
      expect(screen.getByText(`Operator · ${seedSession.workspace.name}`)).toBeVisible(),
    )
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
      await canvas.findByRole('button', { name: `Account of ${sandboxAdminSession.user.name}` }),
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
      await canvas.findByRole('button', { name: `Account of ${seedSession.user.name}` }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/login'))
  },
})
