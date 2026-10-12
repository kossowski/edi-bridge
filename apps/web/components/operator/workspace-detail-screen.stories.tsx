import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { WorkspaceDetailScreen } from '@/components/operator/workspace-detail-screen'
import { OperatorOnly } from '@/components/session/operator-only'
import {
  darkMode,
  expectNoPageScroll,
  german,
  mobile,
  pendingSince,
  withWorkspace,
} from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createInviteEndpoint,
  type Invite,
  operatorWorkspaceMembersEndpoint,
  operatorWorkspaceSettingsEndpoint,
  operatorWorkspacesEndpoint,
  resetSandboxWorkspaceEndpoint,
  revokeInviteEndpoint,
  updateOperatorWorkspaceSettingsEndpoint,
  workspaceInvitesEndpoint,
  type WorkspaceMember,
  type WorkspaceSettings,
} from '@edi-bridge/contracts'
import {
  createInvites,
  createOperatorStore,
  createSessionStore,
  createWorkspaceMembers,
  createWorkspaceSettings,
  operatorHandlers,
  sandboxAdminSession,
  seedInvites,
  seedSandboxWorkspace,
  seedSession,
  seedShowcaseWorkspace,
  seedWorkspace,
  seedWorkspaceSummaries,
  sessionHandlers,
  type WorkspaceSummaryRecord,
  workspaceSettingsHandlers,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../../.storybook/preview'

const pendingEmail = 'jan.petersen@nordwind-handel.example'

const invitesWithPending = seedInvites.map((invite) =>
  invite.email === pendingEmail ? pendingSince(invite, 1) : invite,
)

function operatorMocks({
  invites = invitesWithPending,
  members,
  session = seedSession,
  settings,
  workspaceSummaries = seedWorkspaceSummaries,
}: {
  invites?: ReadonlyArray<Invite>
  members?: ReadonlyArray<WorkspaceMember>
  session?: typeof seedSession
  settings?: WorkspaceSettings
  workspaceSummaries?: ReadonlyArray<WorkspaceSummaryRecord>
} = {}) {
  const sessionStore = createSessionStore(session)
  const workspaces = createOperatorStore({ workspaces: workspaceSummaries, invites })

  return [
    ...sessionHandlers(apiUrl, sessionStore),
    ...operatorHandlers(apiUrl, {
      workspaces,
      session: sessionStore,
      ...(members && { members }),
    }),
    ...workspaceSettingsHandlers(apiUrl, {
      workspaces,
      session: sessionStore,
      ...(settings && { settings }),
    }),
  ]
}

function failing(path: string, method: 'get' | 'put' | 'post' = 'get') {
  return http[method](`${apiUrl}${path}`, () =>
    HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
  )
}

function pending(path: string) {
  return http.get(`${apiUrl}${path}`, async () => {
    await delay('infinite')
  })
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

function onTab(tab: string) {
  return { parameters: { nextjs: { navigation: { query: { tab } } } } }
}

const membersTab = onTab('members')

const limitsTab = onTab('limits')

const dangerTab = onTab('danger')

function panel(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole('tabpanel'))
}

function valueOf(term: HTMLElement) {
  return term.nextElementSibling
}

const meta = preview.meta({
  title: 'Operator/WorkspaceDetailScreen',
  component: WorkspaceDetailScreen,
  args: { id: seedWorkspace.id },
  parameters: {
    layout: 'fullscreen',
    nextjs: { navigation: { pathname: `/operator/workspaces/${seedWorkspace.id}`, query: {} } },
  },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="w-full min-w-0">
          <AppHeader />
          <OperatorOnly>
            <Story />
          </OperatorOnly>
        </div>
      </SidebarProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(...operatorMocks())
  },
})

export const Overview = meta.story({
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: seedWorkspace.name }),
    ).toBeInTheDocument()
    const tabs = await canvas.findAllByRole('tab')
    await expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Members & invites',
      'Limits',
      'Danger zone',
    ])
    await expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const overview = panel(canvasElement)
    await expect(overview.getByText('Customer')).toBeVisible()
    await expect(
      overview.getByText("A customer's own Workspace with real documents."),
    ).toBeVisible()
    await expect(overview.getByText('184')).toBeVisible()
    await expect(overview.getByText('1 open invite')).toBeVisible()
    await expect(overview.getByText(seedWorkspace.gln ?? '')).toBeVisible()
    await expect(
      valueOf(overview.getByText('Last activity'))?.querySelector('time'),
    ).toHaveAttribute('datetime', '2026-10-11T16:42:00.000Z')
    await expect(overview.queryByText('Last reset')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Reset Sandbox' })).toBeNull()
  },
})

export const OverviewSandbox = meta.story({
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('heading', { level: 1, name: seedSandboxWorkspace.name }),
    ).toBeInTheDocument()
    const overview = panel(canvasElement)
    await expect(overview.getByText(/Visitors may change anything/)).toBeVisible()
    await expect(valueOf(overview.getByText('Last reset'))?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-09T17:45:00.000Z',
    )
  },
})

export const OverviewNoActivity = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: [],
        workspaceSummaries: withWorkspace(seedWorkspace.id, {
          memberCount: 0,
          documentsToday: 0,
          lastActivityAt: null,
          seeded: false,
          gln: null,
        }),
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No activity yet')).toBeVisible()
    await expect(canvas.getByText('No open invites')).toBeVisible()
    await expect(canvas.getByText('No GLN')).toBeVisible()
  },
})

export const OverviewLargeNumbers = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: createInvites({ count: 120, workspaceId: seedWorkspace.id }).map((invite) =>
          pendingSince(invite, 1),
        ),
        workspaceSummaries: withWorkspace(seedWorkspace.id, {
          memberCount: 4_321,
          documentsToday: 1_234_567,
        }),
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('1,234,567')).toBeVisible()
    await expect(canvas.getByText('4,321')).toBeVisible()
    await expect(canvas.getByText('120 open invites')).toBeVisible()
  },
})

export const OverviewOnPhone = meta.story({
  ...mobile,
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Danger zone' })).toBeInTheDocument()
    await expect(canvas.getByText('Documents today')).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const OverviewOnPhoneGerman = meta.story({
  ...mobile,
  args: { id: seedSandboxWorkspace.id },
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Gefahrenbereich' })).toBeInTheDocument()
    await expect(canvas.getByText('Belege heute')).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const ChooseLimitsTab = meta.story({
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('tab', { name: 'Limits' }))
    await expect(getRouter().replace).toHaveBeenCalledWith(
      `/operator/workspaces/${seedWorkspace.id}?tab=limits`,
      { scroll: false },
    )
  },
})

export const UnknownTabShowsOverview = meta.story({
  ...onTab('settings'),
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByText('Documents today')).toBeVisible()
  },
})

export const MembersAndInvites = meta.story({
  ...membersTab,
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Members & invites' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByText('Mara Olsen')).toBeVisible()
    await expect(canvas.getByText('4 members')).toBeVisible()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByText('1 open invite')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1)
    await expect(canvas.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    await expect(canvas.getByText('3 earlier invites')).toBeVisible()
    await expect(canvas.getByText(/The link is valid for 7 days/)).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Viewer' })).toBeChecked()
    await expect(canvas.getByRole('radio', { name: 'Admin' })).toHaveAccessibleDescription(
      'Full control: may change everything in this Workspace.',
    )
    await expect(panel(canvasElement).queryByText(/\bsen[dt]\b|by email/i)).toBeNull()
  },
})

export const EarlierInvites = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: [
          ...invitesWithPending,
          {
            ...pendingSince(seedInvites[3]!, 9),
            id: crypto.randomUUID(),
            email: 'old.invite@nordwind-handel.example',
          },
        ],
      }),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByText('4 earlier invites'))
    await expect(canvas.getByText('old.invite@nordwind-handel.example')).toBeVisible()
    await expect(canvas.getByText(/^Expired on /)).toBeVisible()
    await expect(canvas.getAllByText(/^Accepted on /)).toHaveLength(3)
    await expect(canvas.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  },
})

export const NobodyYet = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: [],
        members: [],
        workspaceSummaries: withWorkspace(seedWorkspace.id, { memberCount: 0 }),
      }),
    )
  },
  async play({ canvas }) {
    await expect(
      await canvas.findByText('No members yet. People show up here once they accept their invite.'),
    ).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveTextContent('Invite the first member')
    await expect(await canvas.findByText('No open invites')).toBeVisible()
    await expect(canvas.getByText('Nobody is waiting to join.')).toBeVisible()
    await expect(canvas.queryByText(/earlier invite/)).toBeNull()
  },
})

export const ManyMembersAndInvites = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        members: createWorkspaceMembers({ count: 200 }),
        invites: [
          ...createInvites({ count: 200, workspaceId: seedWorkspace.id }).map((invite) =>
            invite.acceptedAt === null ? pendingSince(invite, 30) : invite,
          ),
          ...createInvites({ count: 120, workspaceId: seedWorkspace.id, seed: 7 }).map((invite) =>
            pendingSince(invite, 1),
          ),
        ],
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('200 members')).toBeVisible()
    await expect(canvas.getByRole('searchbox', { name: 'Find a member' })).toBeVisible()
    await expect(await canvas.findByText('120 open invites')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Revoke' })).toHaveLength(120)
    await expect(canvas.getByText('200 earlier invites')).toBeVisible()
  },
})

export const MembersAndInvitesOnPhone = meta.story({
  ...mobile,
  parameters: { ...mobile.parameters, ...membersTab.parameters },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Revoke' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const MembersLoading = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(pending(operatorWorkspaceMembersEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading members')).toBeInTheDocument()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
  },
})

export const InvitesLoading = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(pending(workspaceInvitesEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading invites')).toBeInTheDocument()
    await expect(await canvas.findByText('Mara Olsen')).toBeVisible()
  },
})

export const MembersUnavailable = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(failing(operatorWorkspaceMembersEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('The members could not be loaded.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
  },
})

export const InvitesUnavailable = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(failing(workspaceInvitesEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('The invites could not be loaded.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

const workspacesFetched = fn()

function countWorkspaceFetches() {
  workspacesFetched.mockClear()

  return http.get(`${apiUrl}${operatorWorkspacesEndpoint.path}`, () => {
    workspacesFetched()
  })
}

export const CreateInviteAndCopyLink = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(countWorkspaceFetches())

    return stubClipboard()
  },
  async play({ canvas }) {
    const email = await canvas.findByRole('textbox', { name: 'Email' })
    await waitFor(() => expect(workspacesFetched).toHaveBeenCalledOnce())
    await userEvent.type(email, 'ana.berg@nordwind-handel.example')
    await userEvent.click(canvas.getByRole('radio', { name: 'Admin' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite link' }))

    await expect(
      await canvas.findByText('Invite link for ana.berg@nordwind-handel.example created'),
    ).toBeVisible()
    await expect(canvas.getByText(/^Valid for 7 days, until /)).toBeVisible()
    await expect(email).toHaveValue('')
    await expect(await canvas.findByText('2 open invites')).toBeVisible()
    await waitFor(() => expect(workspacesFetched).toHaveBeenCalledTimes(2))

    const link = canvas.getByText(/\/invite\//, { selector: 'code' })
    await userEvent.click(canvas.getByRole('button', { name: 'Copy invite link' }))
    await expect(writeText).toHaveBeenCalledWith(link.textContent)
    await expect(await canvas.findAllByText('Copied')).toHaveLength(1)
  },
})

export const CreateInviteDark = meta.story({
  ...membersTab,
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Email' }),
      'ana.berg@nordwind-handel.example',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite link' }))
    await expect(
      await canvas.findByText('Invite link for ana.berg@nordwind-handel.example created'),
    ).toBeVisible()
  },
})

export const CopyPendingLink = meta.story({
  ...membersTab,
  beforeEach() {
    return stubClipboard()
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Copy link' }))
    await expect(writeText).toHaveBeenCalledWith(
      invitesWithPending.find((invite) => invite.email === pendingEmail)?.link,
    )
  },
})

export const CreateInviteValidation = meta.story({
  ...membersTab,
  async play({ canvas }) {
    const email = await canvas.findByRole('textbox', { name: 'Email' })
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite link' }))
    await expect(await canvas.findByText('Enter an email address.')).toBeVisible()
    await expect(email).toHaveFocus()

    await userEvent.type(email, 'ana@')
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite link' }))
    await expect(await canvas.findByText(/Enter a valid email address/)).toBeVisible()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
  },
})

export const CreateInviteFailed = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(failing(createInviteEndpoint.path, 'post'))
  },
  async play({ canvas }) {
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Email' }),
      'ana.berg@nordwind-handel.example',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Create invite link' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The invite could not be created. Try again.',
    )
  },
})

export const RevokeConfirmation = meta.story({
  ...membersTab,
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: `Revoke the invite for ${pendingEmail}?`,
    })

    await expect(dialog).toHaveAccessibleDescription(/stops working at once/)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )
  },
})

export const RevokeConfirmationDark = meta.story({
  ...membersTab,
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(dialog).toBeVisible())
    await expect(within(dialog).getByRole('button', { name: 'Revoke invite' })).toBeVisible()
  },
})

export const RevokeCancelled = meta.story({
  ...membersTab,
  async play({ canvas }) {
    const trigger = await canvas.findByRole('button', { name: 'Revoke' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(canvas.getByText(pendingEmail)).toBeVisible()
  },
})

export const RevokeSucceeds = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(countWorkspaceFetches())
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(workspacesFetched).toHaveBeenCalledOnce())
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke invite' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const count = await canvas.findByText('No open invites')
    await waitFor(() => expect(count).toHaveFocus())
    await expect(canvas.queryByText(pendingEmail)).toBeNull()
    await expect(canvas.getByText(`Invite for ${pendingEmail} revoked.`)).toBeInTheDocument()
    await waitFor(() => expect(workspacesFetched).toHaveBeenCalledTimes(2))
  },
})

export const RevokeFails = meta.story({
  ...membersTab,
  beforeEach({ msw }) {
    msw.use(
      http.delete(`${apiUrl}${revokeInviteEndpoint.path}`, () =>
        HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
      ),
    )
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke invite' }))
    const dialog = await screen.findByRole('alertdialog')
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The invite could not be revoked. Try again.',
    )
    await expect(canvas.getByText(pendingEmail)).toBeVisible()
  },
})

export const MembersAndInvitesGerman = meta.story({
  ...membersTab,
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(
      await canvas.findByRole('tab', { name: 'Mitglieder & Einladungen' }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(await canvas.findByRole('heading', { name: 'Einladungen' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Jemanden einladen' })).toBeVisible()
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Link kopieren' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Zurückziehen' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Viewer' })).toBeChecked()
    await expect(panel(canvasElement).queryByText(/Workspace/)).toBeNull()
  },
})

export const MembersAndInvitesOnPhoneGerman = meta.story({
  ...mobile,
  parameters: { ...mobile.parameters, ...membersTab.parameters },
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(await canvas.findByText('Mara Olsen')).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const MembersAndInvitesDark = meta.story({
  ...membersTab,
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText(pendingEmail)).toBeVisible()
    await expect(await canvas.findByText('Mara Olsen')).toBeVisible()
  },
})

export const Limits = meta.story({
  ...limitsTab,
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('tab', { name: 'Limits' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(await canvas.findByLabelText('Keep documents for (days)')).toHaveValue('90')
    await expect(canvas.getByLabelText('AI tokens per day')).toHaveValue('200,000')
    const limits = panel(canvasElement)
    await expect(limits.getByText('Members see these limits')).toBeVisible()
    await expect(limits.getByText(/Documents older than this are deleted/)).toBeVisible()
    await expect(limits.getByText(/0 turns the AI helper off for this Workspace/)).toBeVisible()
    await expect(limits.getByRole('progressbar', { name: 'Tokens used today' })).toBeVisible()
  },
})

export const LimitsSave = meta.story({
  ...limitsTab,
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Keep documents for (days)')
    await userEvent.clear(retention)
    await userEvent.type(retention, '30')
    await userEvent.click(canvas.getByRole('button', { name: 'Save limits' }))
    await expect(await canvas.findByText('Limits saved.')).toBeVisible()
    await expect(retention).toHaveValue('30')
  },
})

export const LimitsTurnAiOff = meta.story({
  ...limitsTab,
  async play({ canvas }) {
    const budget = await canvas.findByLabelText('AI tokens per day')
    await userEvent.clear(budget)
    await userEvent.type(budget, '0')
    await userEvent.click(canvas.getByRole('button', { name: 'Save limits' }))
    await expect(await canvas.findByText('Limits saved.')).toBeVisible()
    await expect(budget).toHaveValue('0')
  },
})

export const LimitsInvalid = meta.story({
  ...limitsTab,
  async play({ canvas }) {
    const retention = await canvas.findByLabelText('Keep documents for (days)')
    await userEvent.clear(retention)
    await userEvent.click(canvas.getByRole('button', { name: 'Save limits' }))
    await expect(await canvas.findByText('Enter a retention period.')).toBeVisible()
    await expect(retention).toHaveAttribute('aria-invalid', 'true')
  },
})

export const LimitsSaveFailed = meta.story({
  ...limitsTab,
  beforeEach({ msw }) {
    msw.use(failing(updateOperatorWorkspaceSettingsEndpoint.path, 'put'))
  },
  async play({ canvas }) {
    await userEvent.click(await canvas.findByRole('button', { name: 'Save limits' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The limits could not be saved. Try again.',
    )
  },
})

export const LimitsAiTurnedOff = meta.story({
  ...limitsTab,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        settings: createWorkspaceSettings({ aiTokenBudget: { dailyLimit: 0, usedToday: 0 } }),
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('AI is turned off')).toBeVisible()
    await expect(canvas.getByLabelText('AI tokens per day')).toHaveValue('0')
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
})

export const LimitsLargeNumbers = meta.story({
  ...limitsTab,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        settings: createWorkspaceSettings({
          documentRetentionDays: 730,
          aiTokenBudget: { dailyLimit: 10_000_000, usedToday: 9_876_543 },
        }),
      }),
    )
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Keep documents for (days)')).toHaveValue('730')
    await expect(canvas.getByLabelText('AI tokens per day')).toHaveValue('10,000,000')
    await expect(canvas.getByText('9,876,543 of 10,000,000 tokens (99%)')).toBeVisible()
  },
})

export const LimitsLoading = meta.story({
  ...limitsTab,
  beforeEach({ msw }) {
    msw.use(pending(operatorWorkspaceSettingsEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading limits')).toBeInTheDocument()
  },
})

export const LimitsUnavailable = meta.story({
  ...limitsTab,
  beforeEach({ msw }) {
    msw.use(failing(operatorWorkspaceSettingsEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Limits unavailable')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})

export const LimitsGerman = meta.story({
  ...limitsTab,
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Limits' })).toBeVisible()
    await expect(await canvas.findByLabelText('Belege aufbewahren (Tage)')).toHaveValue('90')
    await expect(canvas.getByLabelText('KI-Tokens pro Tag')).toHaveValue('200.000')
    await expect(canvas.getByText(/0 schaltet die KI-Hilfe/)).toBeVisible()
  },
})

export const LimitsDark = meta.story({
  ...limitsTab,
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByLabelText('Keep documents for (days)')).toBeVisible()
    await expect(canvas.getByRole('progressbar', { name: 'Tokens used today' })).toBeVisible()
  },
})

function lastResetValue(canvas: { getByText: typeof screen.getByText }) {
  return valueOf(canvas.getByText('Last reset'))
}

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

const resetDone = `${seedSandboxWorkspace.name} was reset to its example data.`

function resetStatus(canvas: { queryByText: typeof screen.queryByText }) {
  return canvas.queryByText(resetDone, { selector: '[role="status"]' })
}

function resetAlert(canvas: { queryByText: typeof screen.queryByText }) {
  return canvas.queryByText(resetDone, { selector: '[data-slot="alert-description"]' })
}

const neverResetWorkspaces = withWorkspace(seedSandboxWorkspace.id, { lastResetAt: null })

export const DangerZoneSandbox = meta.story({
  ...dangerTab,
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Danger zone' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      await canvas.findByRole('heading', { level: 2, name: 'Reset to example data' }),
    ).toBeVisible()
    await expect(canvas.getByText(/clean before a meeting/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reset Sandbox' })).toBeVisible()
    await expect(lastResetValue(canvas)?.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-10-09T17:45:00.000Z',
    )
  },
})

export const DangerZoneCustomer = meta.story({
  ...dangerTab,
  async play({ canvas }) {
    await expect(
      await canvas.findByRole('heading', { level: 2, name: 'Reset to example data' }),
    ).toBeVisible()
    await expect(
      canvas.getByText(/holds a customer's real data, which is never reset/),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Reset Sandbox' })).toBeNull()
  },
})

export const DangerZoneShowcase = meta.story({
  ...dangerTab,
  args: { id: seedShowcaseWorkspace.id },
  async play({ canvas }) {
    await expect(await canvas.findByText(/Visitors cannot change a Demo/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Reset Sandbox' })).toBeNull()
  },
})

export const SandboxNeverReset = meta.story({
  ...dangerTab,
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
  ...dangerTab,
  args: { id: seedSandboxWorkspace.id },
  async play({ canvas }) {
    const { dialog, cancel, confirm } = await openResetDialog(canvas)
    await expect(
      within(dialog).getByRole('heading', { name: `Reset ${seedSandboxWorkspace.name}?` }),
    ).toBeVisible()
    await expect(dialog).toHaveAccessibleDescription(/replaced by its example data/)
    await expect(dialog).toHaveTextContent('Other Workspaces are not affected.')
    await expect(dialog).toHaveTextContent('This cannot be undone.')
    await waitFor(() => expect(cancel).toHaveFocus())
    await expect(confirm).toBeVisible()
  },
})

export const ResetCancelled = meta.story({
  ...dangerTab,
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
  ...dangerTab,
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
  ...dangerTab,
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
  ...dangerTab,
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
  ...dangerTab,
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

export const DangerZoneGerman = meta.story({
  ...dangerTab,
  args: { id: seedSandboxWorkspace.id },
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByRole('tab', { name: 'Gefahrenbereich' })).toBeVisible()
    await expect(await canvas.findByText('Zuletzt zurückgesetzt')).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: 'Sandbox zurücksetzen' }))
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus(),
    )
    await expect(dialog).toHaveTextContent('Andere Arbeitsbereiche bleiben unverändert.')
  },
})

export const DangerZoneCustomerGerman = meta.story({
  ...dangerTab,
  decorators: [german],
  async play({ canvas }) {
    await expect(await canvas.findByText(/echte Daten eines Kunden/)).toBeVisible()
  },
})

export const DangerZoneDark = meta.story({
  ...dangerTab,
  args: { id: seedSandboxWorkspace.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    const { dialog } = await openResetDialog(canvas)
    await expect(dialog).toHaveTextContent('This cannot be undone.')
  },
})

export const Loading = meta.story({
  beforeEach({ msw }) {
    msw.use(pending(operatorWorkspacesEndpoint.path))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Loading Workspace')).toBeInTheDocument()
    await expect(canvas.queryByRole('tab')).toBeNull()
  },
})

export const Unavailable = meta.story({
  beforeEach({ msw }) {
    msw.use(failing(operatorWorkspacesEndpoint.path))
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
    await expect(canvas.queryByRole('tab')).toBeNull()
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
    await expect(await canvas.findByRole('tab', { name: 'Übersicht' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByText('Belege heute')).toBeVisible()
    await expect(canvas.getByText('Kunde')).toBeVisible()
    await expect(canvas.getByText('1 offene Einladung')).toBeVisible()
    await expect(canvas.getByText('Unternehmens-ID (GLN)')).toBeVisible()
  },
})

export const Dark = meta.story({
  args: { id: seedSandboxWorkspace.id },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Documents today')).toBeVisible()
    await expect(canvas.getByText('Last reset')).toBeVisible()
  },
})
