import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { ReactNode } from 'react'

import { WorkspaceDetailScreen } from '@/components/operator/workspace-detail-screen'
import { OperatorOnly } from '@/components/session/operator-only'
import { apiUrl } from '@/lib/api/config'
import messagesDe from '@/messages/de.json'
import {
  createInviteEndpoint,
  type Invite,
  inviteValidityDays,
  operatorWorkspacesEndpoint,
  resetSandboxWorkspaceEndpoint,
  workspaceInvitesEndpoint,
} from '@edi-bridge/contracts'
import {
  createInvites,
  createOperatorStore,
  createSessionStore,
  operatorHandlers,
  sandboxAdminSession,
  seedInvites,
  seedSandboxWorkspace,
  seedSession,
  seedWorkspace,
  seedWorkspaceSummaries,
  sessionHandlers,
  type WorkspaceSummaryRecord,
  workspaceSettingsHandlers,
} from '@edi-bridge/mocks'

import preview from '../../.storybook/preview'

const dayMs = 24 * 60 * 60 * 1000

function pendingSince(invite: Invite, days: number): Invite {
  const createdAt = Date.now() - days * dayMs

  return {
    ...invite,
    acceptedAt: null,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + inviteValidityDays * dayMs).toISOString(),
  }
}

const pendingEmail = 'jan.petersen@nordwind-handel.example'

const invitesWithPending = seedInvites.map((invite) =>
  invite.email === pendingEmail ? pendingSince(invite, 1) : invite,
)

function operatorMocks({
  invites = invitesWithPending,
  session = seedSession,
  workspaceSummaries = seedWorkspaceSummaries,
}: {
  invites?: ReadonlyArray<Invite>
  session?: typeof seedSession
  workspaceSummaries?: ReadonlyArray<WorkspaceSummaryRecord>
} = {}) {
  const sessionStore = createSessionStore(session)
  const workspaces = createOperatorStore({ workspaces: workspaceSummaries, invites })

  return [
    ...sessionHandlers(apiUrl, sessionStore),
    ...operatorHandlers(apiUrl, { workspaces, session: sessionStore }),
    ...workspaceSettingsHandlers(apiUrl, { workspaces, session: sessionStore }),
  ]
}

const writeText = fn<(text: string) => Promise<void>>(() => Promise.resolve())

function stubClipboard() {
  writeText.mockClear()
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  }
}

const german = (Story: () => ReactNode) => (
  <NextIntlClientProvider locale="de" messages={messagesDe} timeZone="Europe/Berlin">
    <Story />
  </NextIntlClientProvider>
)

const meta = preview.meta({
  title: 'Operator/WorkspaceDetailScreen',
  component: WorkspaceDetailScreen,
  args: { id: seedWorkspace.id },
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
    await expect(
      await canvas.findByRole('heading', { level: 1, name: seedWorkspace.name }),
    ).toBeVisible()
    await expect(canvas.getByText(seedWorkspace.gln ?? '')).toBeVisible()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByText('4 invites')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1)
    await expect(canvas.getByText(/No email is sent/)).toBeVisible()
    await expect(await canvas.findByLabelText('Retention period in days')).toHaveValue('90')
    await expect(canvas.queryByRole('button', { name: 'Reset Sandbox' })).toBeNull()
    await expect(canvas.queryByText('Last reset')).toBeNull()
  },
})

export const InvitesOnPhone = meta.story({
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone', isRotated: false } },
  async play({ canvas }) {
    const table = await canvas.findByRole('table', { name: /Invites of this Workspace/ })
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(canvas.getAllByText(/^Viewer · Created .+ · Expires .+$/)[0]).toBeVisible()
    await expect(canvas.queryByRole('columnheader', { name: 'Role' })).toBeNull()
    await expect(table.scrollWidth).toBeLessThanOrEqual(table.parentElement!.clientWidth)
  },
})

const neverResetWorkspaces = seedWorkspaceSummaries.map((workspace) =>
  workspace.kind === 'sandbox' ? { ...workspace, lastResetAt: null } : workspace,
)

async function openResetDialog(canvas: { findByRole: typeof screen.findByRole }) {
  const trigger = await canvas.findByRole('button', { name: 'Reset Sandbox' })
  await userEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog')
  await waitFor(() => expect(dialog).toBeVisible())

  return {
    trigger,
    dialog,
    cancel: within(dialog).getByRole('button', { name: 'Cancel' }),
    confirm: within(dialog).getByRole('button', { name: 'Reset Sandbox' }),
  }
}

const resetDone = `${seedSandboxWorkspace.name} was reset to its seed data.`

function resetStatus(canvas: { queryByText: typeof screen.queryByText }) {
  return canvas.queryByText(resetDone, { selector: '[role="status"]' })
}

function resetAlert(canvas: { queryByText: typeof screen.queryByText }) {
  return canvas.queryByText(resetDone, { selector: '[data-slot="alert-description"]' })
}

function lastResetValue(canvas: { getByText: typeof screen.getByText }) {
  return canvas.getByText('Last reset').nextElementSibling
}

export const SandboxWorkspace = meta.story({
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: seedSandboxWorkspace.name }),
    ).toBeVisible()
    await expect(canvas.getByText('Sandbox')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reset Sandbox' })).toBeVisible()
    await expect(lastResetValue(canvas)?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-09T17:45:00.000Z',
    )
  },
})

export const SandboxNeverReset = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaceSummaries: neverResetWorkspaces }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Last reset')).toBeVisible()
    await expect(lastResetValue(canvas)).toHaveTextContent('Never')
  },
})

export const ResetConfirmation = meta.story({
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    const { dialog, cancel, confirm } = await openResetDialog(canvas)
    await expect(
      within(dialog).getByRole('heading', { name: `Reset ${seedSandboxWorkspace.name}?` }),
    ).toBeVisible()
    await expect(dialog).toHaveAccessibleDescription(/replaced by its seed data/)
    await expect(dialog).toHaveTextContent('Other Workspaces are not affected.')
    await expect(dialog).toHaveTextContent('This cannot be undone.')
    await waitFor(() => expect(cancel).toHaveFocus())
    await expect(confirm).toBeVisible()
  },
})

export const ResetCancelled = meta.story({
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    const { trigger, dialog, cancel } = await openResetDialog(canvas)
    await userEvent.click(cancel)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(resetStatus(canvas)).toBeNull()
    await expect(resetAlert(canvas)).toBeNull()
  },
})

export const ResetSucceeds = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaceSummaries: neverResetWorkspaces }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Never')).toBeVisible()
    const { trigger, dialog, confirm } = await openResetDialog(canvas)
    await userEvent.click(confirm)

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await waitFor(() => expect(resetStatus(canvas)).not.toBeNull())
    await expect(resetAlert(canvas)).toBeVisible()
    await expect(resetAlert(canvas)?.closest('[aria-hidden="true"]')).not.toBeNull()
    await waitFor(() => expect(lastResetValue(canvas)?.querySelector('time')).not.toBeNull())
    await expect(lastResetValue(canvas)).not.toHaveTextContent('Never')
  },
})

export const ResetPending = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${resetSandboxWorkspaceEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    const { dialog, cancel, confirm } = await openResetDialog(canvas)
    await userEvent.click(confirm)
    await expect(await within(dialog).findByRole('button', { name: 'Resetting…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(cancel).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(dialog).toBeVisible()
    await userEvent.click(cancel)
    await expect(dialog).toBeVisible()
  },
})

export const ResetFails = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach({ msw }) {
    msw.use(
      http.post(
        `${apiUrl}${resetSandboxWorkspaceEndpoint.path}`,
        () => HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
        { once: true },
      ),
    )
  },
  async play({ canvas }) {
    const { dialog, confirm } = await openResetDialog(canvas)
    await userEvent.click(confirm)
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The Sandbox could not be reset. Try again.',
    )
    await expect(dialog).toBeVisible()

    await userEvent.click(confirm)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() => expect(resetAlert(canvas)).toBeVisible())
    await expect(resetStatus(canvas)).not.toBeNull()
  },
})

export const ResetSucceedsThenFailsOnReopen = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach({ msw }) {
    let calls = 0
    msw.use(
      http.post(`${apiUrl}${resetSandboxWorkspaceEndpoint.path}`, () => {
        calls += 1

        return calls > 1
          ? HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 })
          : undefined
      }),
    )
  },
  async play({ canvas }) {
    const first = await openResetDialog(canvas)
    await userEvent.click(first.confirm)
    await waitFor(() => expect(first.dialog).not.toBeInTheDocument())
    await waitFor(() => expect(resetAlert(canvas)).toBeVisible())

    const second = await openResetDialog(canvas)
    await expect(resetAlert(canvas)).toBeNull()
    await expect(resetStatus(canvas)).toBeNull()
    await userEvent.click(second.confirm)
    await expect(await within(second.dialog).findByRole('alert')).toHaveTextContent(
      'The Sandbox could not be reset. Try again.',
    )
    await userEvent.click(second.cancel)
    await waitFor(() => expect(second.dialog).not.toBeInTheDocument())
    await expect(resetAlert(canvas)).toBeNull()
    await expect(resetStatus(canvas)).toBeNull()
  },
})

export const SandboxGerman = meta.story({
  args: { id: seedSandboxWorkspace.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText('Zuletzt zurückgesetzt')).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: 'Sandbox zurücksetzen' }))
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus(),
    )
    await expect(dialog).toHaveTextContent('Andere Workspaces bleiben unverändert.')
  },
})

export const SandboxDark = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    const { dialog } = await openResetDialog(canvas)
    await expect(dialog).toHaveTextContent('This cannot be undone.')
  },
})

export const NoInvites = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ invites: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No invites yet.')).toBeVisible()
    await expect(canvas.queryByRole('table')).toBeNull()
  },
})

export const ManyInvites = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: [
          ...createInvites({ count: 200, workspaceId: seedWorkspace.id }),
          pendingSince(seedInvites[3]!, 2),
        ],
      }),
    )
  },
  // Contrast is checked on the same rows in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas }) {
    await expect(await canvas.findByText('201 invites')).toBeVisible()
    await expect(canvas.getAllByRole('row')).toHaveLength(202)
  },
})

export const InvitesLoading = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${workspaceInvitesEndpoint.path}`, async () => {
        await delay('infinite')
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading invites')).toBeInTheDocument()
  },
})

export const InvitesUnavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get(`${apiUrl}${workspaceInvitesEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('The invites could not be loaded.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const CreateInviteAndCopyLink = meta.story({
  beforeEach() {
    return stubClipboard()
  },
  async play({ canvas }) {
    const email = await canvas.findByRole('textbox', { name: 'Email' })
    await userEvent.type(email, 'ana.berg@nordwind-handel.example')
    await userEvent.click(canvas.getByRole('radio', { name: 'Admin' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite' }))

    await expect(
      await canvas.findByText('Invite for ana.berg@nordwind-handel.example created'),
    ).toBeVisible()
    await expect(email).toHaveValue('')
    await expect(await canvas.findByText('ana.berg@nordwind-handel.example')).toBeVisible()

    const link = canvas.getByText(/\/invite\//, { selector: 'code' })
    await userEvent.click(canvas.getByRole('button', { name: 'Copy invite link' }))
    await expect(writeText).toHaveBeenCalledWith(link.textContent)
    await expect(await canvas.findAllByText('Copied')).toHaveLength(1)
  },
})

export const CreateInviteValidation = meta.story({
  async play({ canvas }) {
    const email = await canvas.findByRole('textbox', { name: 'Email' })
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite' }))
    await expect(await canvas.findByText('Enter an email address.')).toBeVisible()
    await expect(email).toHaveFocus()

    await userEvent.type(email, 'ana@')
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite' }))
    await expect(await canvas.findByText(/Enter a valid email address/)).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
  },
})

export const CreateInviteFailed = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post(`${apiUrl}${createInviteEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Email' }),
      'ana.berg@nordwind-handel.example',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The invite could not be created. Try again.',
    )
  },
})

export const SettingsSave = meta.story({
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Retention period in days')
    await userEvent.clear(retention)
    await userEvent.type(retention, '30')
    await userEvent.click(canvas.getByRole('button', { name: 'Save retention and AI budget' }))
    await expect(await canvas.findByText('Retention and AI budget saved.')).toBeVisible()
    await expect(retention).toHaveValue('30')
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
    await expect(await canvas.findByText('Loading Workspace')).toBeInTheDocument()
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
    await expect(await canvas.findByText('Workspace unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const NotFound = meta.story({
  args: { id: '00000000-0000-4000-8000-000000000000' },
  async play({ canvas }) {
    await expect(await canvas.findByText('Workspace not found')).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 1, name: 'Details' })).toBeInTheDocument()
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
    await expect(await canvas.findByRole('heading', { name: 'Einladungen' })).toBeVisible()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Link kopieren' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Viewer' })).toBeChecked()
  },
})

export const Dark = meta.story({
  beforeEach() {
    document.documentElement.classList.add('dark')

    return () => document.documentElement.classList.remove('dark')
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await waitFor(() => expect(canvas.getByLabelText('Retention period in days')).toBeVisible())
  },
})
