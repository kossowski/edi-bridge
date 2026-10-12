import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { AppHeader } from '@/components/app-header'
import { WorkspacesScreen } from '@/components/operator/workspaces-screen'
import { OperatorOnly } from '@/components/session/operator-only'
import { darkMode, expectNoPageScroll, german, mobile } from '@/components/story-helpers'
import { apiUrl } from '@/lib/api/config'
import {
  createWorkspaceEndpoint,
  type Invite,
  inviteValidityDays,
  maxWorkspaceNameLength,
  operatorWorkspacesEndpoint,
  type Session,
} from '@edi-bridge/contracts'
import {
  createInvites,
  createOperatorStore,
  createSessionStore,
  createWorkspaceSummaries,
  operatorHandlers,
  sandboxAdminSession,
  seedSandboxWorkspace,
  seedSession,
  seedShowcaseWorkspace,
  seedWorkspace,
  seedWorkspaceSummaries,
  sessionHandlers,
  type WorkspaceSummaryRecord,
} from '@edi-bridge/mocks'
import { SidebarProvider } from '@edi-bridge/ui/components/sidebar'

import preview from '../../.storybook/preview'

const dayMs = 24 * 60 * 60 * 1000

function pendingInvites(count: number, workspaceId: string): Invite[] {
  const createdAt = Date.now() - dayMs

  return createInvites({ count, workspaceId }).map((invite) => ({
    ...invite,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + inviteValidityDays * dayMs).toISOString(),
  }))
}

function operatorMocks({
  workspaces = seedWorkspaceSummaries,
  invites = pendingInvites(2, seedWorkspace.id),
  session = seedSession,
}: {
  workspaces?: ReadonlyArray<WorkspaceSummaryRecord>
  invites?: ReadonlyArray<Invite>
  session?: Session
} = {}) {
  const sessionStore = createSessionStore(session)

  return [
    ...sessionHandlers(apiUrl, sessionStore),
    ...operatorHandlers(apiUrl, {
      workspaces: createOperatorStore({ workspaces, invites }),
      session: sessionStore,
    }),
  ]
}

function group(canvasElement: HTMLElement, name: RegExp) {
  return within(within(canvasElement).getByRole('region', { name }))
}

function facts(card: HTMLElement) {
  return Object.fromEntries(
    within(card)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  )
}

function cardOf(link: HTMLElement) {
  const card = link.closest('li')

  if (!card) {
    throw new Error('The link is not inside a card')
  }

  return card
}

const meta = preview.meta({
  title: 'Operator/WorkspacesScreen',
  component: WorkspacesScreen,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/operator' } } },
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

export const Default = meta.story({
  async play({ canvas, canvasElement }) {
    const link = await canvas.findByRole('link', { name: seedWorkspace.name })
    await expect(link).toHaveAttribute('href', `/operator/workspaces/${seedWorkspace.id}`)
    await expect(
      canvas.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Customers (1)', 'Demo (1)', 'Sandbox (1)'])
    await expect(
      canvas.getByText('Real companies exchanging real documents. You invite their members.'),
    ).toBeVisible()
    const { 'Last activity': lastActivity, ...counts } = facts(cardOf(link))
    await expect(counts).toEqual({ 'Documents today': '184', Members: '4', 'Open invites': '2' })
    await expect(lastActivity).toMatch(/Oct 11, 2026/)
    await expect(
      group(canvasElement, /^Demo/).getByRole('link', { name: seedShowcaseWorkspace.name }),
    ).toBeVisible()
    await expect(
      group(canvasElement, /^Sandbox/).getByRole('link', { name: seedSandboxWorkspace.name }),
    ).toBeVisible()
  },
})

export const NoActivityYet = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        invites: [],
        workspaces: seedWorkspaceSummaries.map((workspace) =>
          workspace.id === seedWorkspace.id
            ? { ...workspace, memberCount: 0, documentsToday: 0, lastActivityAt: null }
            : workspace,
        ),
      }),
    )
  },
  async play({ canvas }) {
    const link = await canvas.findByRole('link', { name: seedWorkspace.name })
    await expect(facts(cardOf(link))).toEqual({
      'Documents today': '0',
      'Last activity': 'No activity yet',
      Members: '0',
    })
  },
})

export const EmptyKinds = meta.story({
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        workspaces: seedWorkspaceSummaries.filter((workspace) => workspace.kind === 'standard'),
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('link', { name: seedWorkspace.name })).toBeVisible()
    await expect(group(canvasElement, /^Demo/).getByText('No Demo yet.')).toBeVisible()
    await expect(group(canvasElement, /^Sandbox/).getByText('No Sandbox yet.')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Demo (0)' })).toBeVisible()
  },
})

export const Empty = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaces: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('No Workspaces yet')).toBeVisible()
    await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull()
    await expect(canvas.getAllByRole('button', { name: 'Create Workspace' })).toHaveLength(2)
  },
})

export const LargeVolume = meta.story({
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaces: createWorkspaceSummaries({ count: 400 }) }))
  },
  // Contrast is checked on the same cards in the small stories. Over a large DOM it makes axe
  // outrun the test timeout on CI, so only the structural rules run here.
  parameters: { a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } } },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('heading', { name: 'Customers (400)' })).toBeVisible()
    await expect(group(canvasElement, /^Customers/).getAllByRole('listitem')).toHaveLength(400)
    await expect(canvas.getByText('No Demo yet.')).toBeVisible()
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
    const { dialog, name } = await openCreateDialog(canvas)
    await expect(name).toHaveFocus()
    const seed = dialog.getByRole('switch', { name: 'Start with example data' })
    await expect(seed).toBeChecked()
    await expect(seed).toHaveAccessibleDescription(/Turn it off for a customer/)
    await userEvent.type(name, 'Ostsee Feinkost AG')
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))

    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/operator\/workspaces\/[\w-]+\?tab=members$/),
      ),
    )
  },
})

export const CreateWorkspaceWithoutExampleData = meta.story({
  parameters: { a11y: { context: 'body' } },
  async play({ canvas }) {
    const { dialog, name } = await openCreateDialog(canvas)
    const seed = dialog.getByRole('switch', { name: 'Start with example data' })
    await userEvent.click(seed)
    await expect(seed).not.toBeChecked()
    await userEvent.type(name, 'Ostsee Feinkost AG')
    await userEvent.click(dialog.getByRole('button', { name: 'Create Workspace' }))

    await waitFor(() =>
      expect(getRouter().push).toHaveBeenCalledWith(expect.stringMatching(/\?tab=members$/)),
    )
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

export const CreateWorkspaceDark = meta.story({
  parameters: { a11y: { context: 'body' } },
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    const { dialog } = await openCreateDialog(canvas)
    await expect(dialog.getByRole('switch', { name: 'Start with example data' })).toBeChecked()
  },
})

export const CreateWorkspaceGerman = meta.story({
  parameters: { a11y: { context: 'body' } },
  decorators: [german],
  async play({ canvas }) {
    await canvas.findByRole('link', { name: seedWorkspace.name })
    await userEvent.click(canvas.getByRole('button', { name: 'Arbeitsbereich anlegen' }))
    const element = await screen.findByRole('dialog')
    await waitFor(() => expect(element).toBeVisible())
    const dialog = within(element)
    await expect(dialog.getByRole('switch', { name: 'Mit Beispieldaten starten' })).toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Arbeitsbereich anlegen' })).toBeVisible()
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
    await expect(
      canvas.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Kunden (1)', 'Demo (1)', 'Sandbox (1)'])
    await expect(canvas.getAllByText('Belege heute')).toHaveLength(3)
    await expect(canvas.getByText('Offene Einladungen')).toBeVisible()
  },
})

export const GermanEmpty = meta.story({
  decorators: [german],
  beforeEach({ msw }) {
    msw.use(...operatorMocks({ workspaces: [] }))
  },
  async play({ canvas }) {
    await expect(await canvas.findByText('Noch keine Arbeitsbereiche')).toBeVisible()
  },
})

export const Dark = meta.story({
  beforeEach() {
    return darkMode()
  },
  async play({ canvas }) {
    await expect(await canvas.findByRole('link', { name: seedWorkspace.name })).toBeVisible()
  },
})

export const OnPhone = meta.story({
  ...mobile,
  beforeEach({ msw }) {
    msw.use(
      ...operatorMocks({
        workspaces: seedWorkspaceSummaries.map((workspace) =>
          workspace.id === seedWorkspace.id
            ? { ...workspace, name: 'Nordwind Handelsgesellschaft für Feinkost und Getränke mbH' }
            : workspace,
        ),
      }),
    )
  },
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('heading', { name: 'Customers (1)' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})

export const OnPhoneGerman = meta.story({
  ...mobile,
  decorators: [german],
  async play({ canvas, canvasElement }) {
    await expect(await canvas.findByRole('heading', { name: 'Kunden (1)' })).toBeVisible()
    await expectNoPageScroll(canvasElement)
  },
})
