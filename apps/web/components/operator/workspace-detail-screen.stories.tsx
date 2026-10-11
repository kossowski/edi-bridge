import { delay, http, HttpResponse } from 'msw'
import { NextIntlClientProvider } from 'next-intl'
import { expect, fn, userEvent, waitFor } from 'storybook/test'

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
  sessionHandlers,
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
}: { invites?: ReadonlyArray<Invite>; session?: typeof seedSession } = {}) {
  const sessionStore = createSessionStore(session)
  const workspaces = createOperatorStore({ invites })

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
    await expect(await canvas.findByRole('cell', { name: pendingEmail })).toBeVisible()
    await expect(canvas.getByText('4 invites')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1)
    await expect(canvas.getByText(/No email is sent/)).toBeVisible()
    await expect(await canvas.findByLabelText('Retention period in days')).toHaveValue('90')
  },
})

export const SandboxWorkspace = meta.story({
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: seedSandboxWorkspace.name }),
    ).toBeVisible()
    await expect(canvas.getByText('Sandbox')).toBeVisible()
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
    await expect(
      await canvas.findByRole('cell', { name: 'ana.berg@nordwind-handel.example' }),
    ).toBeVisible()

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
    await expect(canvas.getByRole('link', { name: 'All Workspaces' })).toBeVisible()
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
    await expect(await canvas.findByRole('cell', { name: pendingEmail })).toBeVisible()
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
    await expect(await canvas.findByRole('cell', { name: pendingEmail })).toBeVisible()
    await waitFor(() => expect(canvas.getByLabelText('Retention period in days')).toBeVisible())
  },
})
