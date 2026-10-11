import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import type { ReactNode } from 'react'

import { WorkspacesScreen } from '@/components/operator/workspaces-screen'
import { OperatorOnly } from '@/components/session/operator-only'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  createWorkspaceEndpoint,
  maxWorkspaceNameLength,
  operatorWorkspacesEndpoint,
  type Session,
  type WorkspaceSummary,
} from '@edi-bridge/contracts'
import {
  createOperatorStore,
  createSessionStore,
  createWorkspaceSummaries,
  operatorHandlers,
  sandboxAdminSession,
  seedSession,
  seedWorkspace,
  seedWorkspaceSummaries,
  sessionHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

function operatorMocks({
  workspaces = seedWorkspaceSummaries,
  session = seedSession,
}: { workspaces?: ReadonlyArray<WorkspaceSummary>; session?: Session } = {}) {
  const sessionStore = createSessionStore(session)

  return [
    ...sessionHandlers(apiUrl, sessionStore),
    ...operatorHandlers(apiUrl, {
      workspaces: createOperatorStore({ workspaces }),
      session: sessionStore,
    }),
  ]
}

const german = (Story: () => ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

const meta = preview.meta({
  title: 'Operator/WorkspacesScreen',
  component: WorkspacesScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <OperatorOnly>
        <Story />
      </OperatorOnly>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...operatorMocks())
  },
})

export const Default = meta.story({
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: seedWorkspace.name })).toBeVisible()
    await expect(canvas.getByText('3 Workspaces')).toBeVisible()
    await expect(canvas.getByText('Showcase')).toBeVisible()
    await expect(canvas.getByText('Sandbox')).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Seed data' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaces: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Workspaces yet')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Create Workspace' })).toHaveLength(2)
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaces: createWorkspaceSummaries({ count: 400 }) }))
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('400 Workspaces')).toBeVisible()
    await userEvent.type(canvas.getByLabelText('Search by name or GLN'), 'zzz-no-match')
    await expect(await canvas.findByText('No Workspace matches the search.')).toBeVisible()
    await expect(canvas.getByText('0 of 400 Workspaces')).toBeVisible()
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${operatorWorkspacesEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading Workspaces')).toBeInTheDocument()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${operatorWorkspacesEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Workspaces unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

async function openCreateDialog(canvas: { findByRole: typeof screen.findByRole }) {
  await canvas.findByRole('link', { name: seedWorkspace.name })
  const create = await canvas.findByRole('button', { name: 'Create Workspace' })
  await userEvent.click(create)
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(dialog).toBeVisible())

  return {
    create,
    dialog: within(dialog),
    name: within(dialog).getByRole('textbox', { name: 'Name' }),
  }
}

export const CreateWorkspace = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    const { create, dialog, name } = await openCreateDialog(canvas)
    await expect(name).toHaveFocus()
    await expect(dialog.getByRole('checkbox', { name: 'Start from seed data' })).toBeChecked()
    await userEvent.type(name, 'Ostsee Feinkost AG')
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))

    await expect(await canvas.findByText(/Workspace Ostsee Feinkost AG created/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Open Ostsee Feinkost AG' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Ostsee Feinkost AG' })).toBeVisible()
    await expect(await canvas.findByText('4 Workspaces')).toBeVisible()
    await waitFor(() => expect(create).toHaveFocus())
  },
})

export const CreateWorkspaceDuplicateName = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    const { dialog, name } = await openCreateDialog(canvas)
    await userEvent.type(name, seedWorkspace.name.toLocaleUpperCase())
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))

    await expect(await dialog.findByText('Another Workspace already uses this name.')).toBeVisible()
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveFocus()
  },
})

export const CreateWorkspaceValidation = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    const { dialog, name } = await openCreateDialog(canvas)
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))
    await expect(await dialog.findByText('Enter a name.')).toBeVisible()
    await expect(name).toHaveFocus()

    await userEvent.type(name, 'x'.repeat(maxWorkspaceNameLength + 1))
    await expect(
      await dialog.findByText(`Use at most ${maxWorkspaceNameLength} characters.`),
    ).toBeVisible()
  },
})

export const CreateWorkspaceFailed = meta.story({
  parameters: { a11y: { context: 'body' } },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createWorkspaceEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    const { dialog, name } = await openCreateDialog(canvas)
    await userEvent.type(name, 'Ostsee Feinkost AG')
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The Workspace could not be created. Try again.',
    )
  },
})

export const NotForAdmins = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ session: sandboxAdminSession }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('heading', { name: 'Page not found' })).toBeVisible()
  },
})

export const German = meta.story({
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: seedWorkspace.name })).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Seed-Daten' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Workspace anlegen' })).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: seedWorkspace.name })).toBeVisible()
  },
})
