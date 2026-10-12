import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  createInviteEndpoint,
  createWorkspaceEndpoint,
  type Invite,
  inviteSchema,
  inviteValidityDays,
  operatorWorkspaceMembersEndpoint,
  resetSandboxWorkspaceEndpoint,
  revokeInviteEndpoint,
  workspaceInvitesEndpoint,
  type WorkspaceRole,
  operatorWorkspacesEndpoint,
  type Session,
  type Workspace,
  type WorkspaceSummary,
  workspaceSummarySchema,
} from '@edi-bridge/contracts'

import { dayMs } from './duration'
import { randomGln } from './gln'
import { badRequest, conflict, notFound } from './responses'
import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { mockCredentials, seedSession, showcaseViewerSession, toSessionStore } from './session'
import { operatorOnly, type SessionStore } from './session-access'
import {
  createWorkspaceStore,
  seedSandboxWorkspace,
  seedShowcaseWorkspace,
  seedWorkspace,
  type WorkspaceStore,
} from './workspace'
import {
  seedWorkspaceMembers,
  toWorkspaceMemberStore,
  type WorkspaceMembers,
} from './workspace-member'

export const seedWorkspaceSummaries: ReadonlyArray<WorkspaceSummary> = [
  {
    ...seedWorkspace,
    kind: 'standard',
    memberCount: 4,
    pendingInviteCount: 1,
    documentsToday: 184,
    lastActivityAt: '2026-10-11T16:42:00.000Z',
    seeded: true,
    createdAt: '2026-01-12T09:30:00.000Z',
    lastResetAt: null,
  },
  {
    ...seedShowcaseWorkspace,
    kind: 'showcase',
    memberCount: 4,
    pendingInviteCount: 0,
    documentsToday: 37,
    lastActivityAt: '2026-10-11T19:03:00.000Z',
    seeded: true,
    createdAt: '2026-02-02T08:00:00.000Z',
    lastResetAt: null,
  },
  {
    ...seedSandboxWorkspace,
    kind: 'sandbox',
    memberCount: 1,
    pendingInviteCount: 0,
    documentsToday: 12,
    lastActivityAt: '2026-10-10T11:26:00.000Z',
    seeded: true,
    createdAt: '2026-02-02T08:05:00.000Z',
    lastResetAt: '2026-10-09T17:45:00.000Z',
  },
].map((workspace) => workspaceSummarySchema.parse(workspace))

function generateWorkspaceSummary(faker: Faker, now: Date): WorkspaceSummary {
  const createdAt = faker.date.past({ years: 3, refDate: now })
  const quiet = faker.datatype.boolean(0.15)

  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: faker.datatype.boolean(0.85) ? randomGln(faker) : null,
    kind: 'standard',
    memberCount: faker.number.int({ min: 0, max: 40 }),
    pendingInviteCount: faker.datatype.boolean(0.3) ? faker.number.int({ min: 1, max: 12 }) : 0,
    documentsToday: quiet ? 0 : faker.number.int({ min: 0, max: 25_000 }),
    lastActivityAt: quiet ? null : faker.date.between({ from: createdAt, to: now }).toISOString(),
    seeded: faker.datatype.boolean(0.3),
    createdAt: createdAt.toISOString(),
    lastResetAt: null,
  }
}

export function createWorkspaceSummaries({
  count,
  now = new Date(),
  seed = 18,
}: {
  count: number
  now?: Date
  seed?: number
}): WorkspaceSummary[] {
  const faker = new Faker({ locale: [en], seed })
  const byName = new Map<string, WorkspaceSummary>()

  while (byName.size < count) {
    const workspace = generateWorkspaceSummary(faker, now)

    if (!byName.has(workspace.name)) {
      byName.set(workspace.name, workspaceSummarySchema.parse(workspace))
    }
  }

  return [...byName.values()]
}

const defaultAppUrl = 'http://localhost:3000'

function inviteLink(appUrl: string, token: string) {
  return `${appUrl}/invite/${token}`
}

function toInvite(
  {
    createdAt,
    ...invite
  }: Pick<Invite, 'id' | 'workspaceId' | 'email' | 'role' | 'createdAt' | 'acceptedAt'>,
  appUrl: string,
  token: string,
): Invite {
  return inviteSchema.parse({
    ...invite,
    revokedAt: null,
    createdAt,
    link: inviteLink(appUrl, token),
    expiresAt: new Date(Date.parse(createdAt) + inviteValidityDays * dayMs).toISOString(),
  })
}

const inviteSeeds: ReadonlyArray<
  Pick<Invite, 'workspaceId' | 'email' | 'role' | 'createdAt' | 'acceptedAt'>
> = [
  {
    workspaceId: seedWorkspace.id,
    email: 'mara.olsen@nordwind-handel.example',
    role: 'admin',
    createdAt: '2026-01-12T10:00:00.000Z',
    acceptedAt: '2026-01-12T14:21:00.000Z',
  },
  {
    workspaceId: seedWorkspace.id,
    email: 'tobias.reuter@nordwind-handel.example',
    role: 'admin',
    createdAt: '2026-03-03T08:15:00.000Z',
    acceptedAt: '2026-03-04T07:02:00.000Z',
  },
  {
    workspaceId: seedWorkspace.id,
    email: 'lena.hoffmann@nordwind-handel.example',
    role: 'viewer',
    createdAt: '2026-06-20T12:40:00.000Z',
    acceptedAt: '2026-06-22T09:10:00.000Z',
  },
  {
    workspaceId: seedWorkspace.id,
    email: 'jan.petersen@nordwind-handel.example',
    role: 'viewer',
    createdAt: '2026-10-08T15:30:00.000Z',
    acceptedAt: null,
  },
  {
    workspaceId: seedShowcaseWorkspace.id,
    email: showcaseViewerSession.user.email,
    role: 'viewer',
    createdAt: '2026-02-02T08:01:00.000Z',
    acceptedAt: '2026-02-02T08:02:00.000Z',
  },
  {
    workspaceId: seedSandboxWorkspace.id,
    email: mockCredentials.sandboxAdmin.email,
    role: 'admin',
    createdAt: '2026-02-02T08:06:00.000Z',
    acceptedAt: '2026-02-02T08:07:00.000Z',
  },
]

export const seedInvites: ReadonlyArray<Invite> = inviteSeeds.map((seed, index) => {
  const id = seedId(10, index + 1)

  return toInvite({ ...seed, id }, defaultAppUrl, seededFaker(`invite:${id}`).string.uuid())
})

export function createInvites({
  count,
  workspaceId,
  now = new Date(),
  seed = 18,
  appUrl = defaultAppUrl,
}: {
  count: number
  workspaceId: string
  now?: Date
  seed?: number
  appUrl?: string
}): Invite[] {
  const faker = new Faker({ locale: [en], seed })
  const byEmail = new Map<string, Invite>()

  while (byEmail.size < count) {
    const createdAt = faker.date.past({ years: 1, refDate: now })
    const accepted = faker.datatype.boolean(0.7)

    const invite = toInvite(
      {
        id: faker.string.uuid(),
        workspaceId,
        email: faker.internet.email({ provider: 'example.com' }).toLowerCase(),
        role: faker.helpers.weightedArrayElement<WorkspaceRole>([
          { value: 'viewer', weight: 3 },
          { value: 'admin', weight: 1 },
        ]),
        createdAt: createdAt.toISOString(),
        acceptedAt: accepted
          ? new Date(
              createdAt.getTime() + faker.number.int({ min: 1, max: 6 * 24 * 60 }) * 60_000,
            ).toISOString()
          : null,
      },
      appUrl,
      faker.string.uuid(),
    )

    if (!byEmail.has(invite.email)) {
      byEmail.set(invite.email, invite)
    }
  }

  return [...byEmail.values()]
}

function sameName(a: string, b: string) {
  return a.localeCompare(b, 'de', { sensitivity: 'accent' }) === 0
}

export type OperatorStore = {
  workspaces: () => readonly WorkspaceSummary[]
  workspace: (id: string) => WorkspaceSummary | undefined
  setWorkspace: (workspace: WorkspaceSummary) => void
  invites: (workspaceId: string) => readonly Invite[]
  invite: (workspaceId: string, inviteId: string) => Invite | undefined
  setInvite: (invite: Invite) => void
}

export function createOperatorStore({
  workspaces = seedWorkspaceSummaries,
  invites = seedInvites,
}: {
  workspaces?: ReadonlyArray<WorkspaceSummary>
  invites?: ReadonlyArray<Invite>
} = {}): OperatorStore {
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const invitesById = new Map(invites.map((invite) => [invite.id, invite]))

  const listed = (workspaceId: string) =>
    [...invitesById.values()].filter(
      (invite) => invite.workspaceId === workspaceId && invite.revokedAt === null,
    )

  return {
    workspaces: () => [...byId.values()],
    workspace: (id) => byId.get(id),
    setWorkspace: (workspace) => {
      byId.set(workspace.id, workspace)
    },
    invites: (workspaceId) =>
      listed(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    invite: (workspaceId, inviteId) => listed(workspaceId).find(({ id }) => id === inviteId),
    setInvite: (invite) => {
      invitesById.set(invite.id, invite)
    },
  }
}

export function toOperatorStore(
  workspaces: ReadonlyArray<WorkspaceSummary> | OperatorStore = seedWorkspaceSummaries,
  invites: ReadonlyArray<Invite> = seedInvites,
) {
  return 'workspace' in workspaces ? workspaces : createOperatorStore({ workspaces, invites })
}

export function sessionWorkspaceStore({
  workspaces,
  session,
  fallback,
}: {
  workspaces: OperatorStore
  session: SessionStore
  fallback: Workspace
}): WorkspaceStore {
  const own = createWorkspaceStore(fallback)
  const listed = () => workspaces.workspace(session.get()?.workspace.id ?? fallback.id)

  return {
    get: () => {
      const summary = listed()

      return summary ? { id: summary.id, name: summary.name, gln: summary.gln } : own.get()
    },
    set: (next) => {
      const summary = workspaces.workspace(next.id)

      if (summary) {
        workspaces.setWorkspace({ ...summary, ...next })
      } else {
        own.set(next)
      }
    },
  }
}

export function operatorHandlers(
  apiUrl: string,
  {
    workspaces = seedWorkspaceSummaries,
    invites = seedInvites,
    members = seedWorkspaceMembers,
    session = seedSession,
    appUrl = globalThis.location?.origin ?? defaultAppUrl,
  }: {
    workspaces?: ReadonlyArray<WorkspaceSummary> | OperatorStore
    invites?: ReadonlyArray<Invite>
    members?: WorkspaceMembers
    session?: Session | null | SessionStore
    appUrl?: string
  } = {},
) {
  const store = toOperatorStore(workspaces, invites)
  const memberStore = toWorkspaceMemberStore(members)
  const sessionStore = toSessionStore(session)

  return [
    http.get(
      `${apiUrl}${operatorWorkspacesEndpoint.path}`,
      operatorOnly(sessionStore, () =>
        HttpResponse.json(
          [...store.workspaces()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
        ),
      ),
    ),
    http.post(
      `${apiUrl}${createWorkspaceEndpoint.path}`,
      operatorOnly(sessionStore, async ({ request }) => {
        const body = createWorkspaceEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const { name, seed } = body.data

        if (store.workspaces().some((workspace) => sameName(workspace.name, name))) {
          return conflict('Another Workspace already uses this name')
        }

        const id = crypto.randomUUID()

        const created: WorkspaceSummary = {
          id,
          name,
          gln: seed ? randomGln(seededFaker(`workspace:${id}`)) : null,
          kind: 'standard',
          memberCount: 0,
          pendingInviteCount: 0,
          documentsToday: 0,
          lastActivityAt: null,
          seeded: seed,
          createdAt: new Date().toISOString(),
          lastResetAt: null,
        }

        store.setWorkspace(created)

        return HttpResponse.json(created, { status: 201 })
      }),
    ),
    http.get<{ workspaceId: string }>(
      `${apiUrl}${operatorWorkspaceMembersEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) =>
        store.workspace(params.workspaceId)
          ? HttpResponse.json(memberStore.get(params.workspaceId))
          : notFound(),
      ),
    ),
    http.get<{ workspaceId: string }>(
      `${apiUrl}${workspaceInvitesEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) =>
        store.workspace(params.workspaceId)
          ? HttpResponse.json(store.invites(params.workspaceId))
          : notFound(),
      ),
    ),
    http.post<{ workspaceId: string }>(
      `${apiUrl}${createInviteEndpoint.path}`,
      operatorOnly(sessionStore, async ({ params, request }) => {
        const workspace = store.workspace(params.workspaceId)

        if (!workspace) {
          return notFound()
        }

        const body = createInviteEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const invite = toInvite(
          {
            ...body.data,
            id: crypto.randomUUID(),
            workspaceId: params.workspaceId,
            createdAt: new Date().toISOString(),
            acceptedAt: null,
          },
          appUrl,
          crypto.randomUUID(),
        )

        store.setInvite(invite)
        store.setWorkspace({ ...workspace, pendingInviteCount: workspace.pendingInviteCount + 1 })

        return HttpResponse.json(invite, { status: 201 })
      }),
    ),
    http.delete<{ workspaceId: string; inviteId: string }>(
      `${apiUrl}${revokeInviteEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) => {
        const workspace = store.workspace(params.workspaceId)
        const invite = store.invite(params.workspaceId, params.inviteId)

        if (!workspace || !invite) {
          return notFound()
        }

        if (invite.acceptedAt !== null) {
          return conflict('An accepted invite cannot be revoked')
        }

        const revoked = { ...invite, revokedAt: new Date().toISOString() }
        store.setInvite(revoked)
        store.setWorkspace({
          ...workspace,
          pendingInviteCount: Math.max(0, workspace.pendingInviteCount - 1),
        })

        return HttpResponse.json(revoked)
      }),
    ),
    http.post<{ workspaceId: string }>(
      `${apiUrl}${resetSandboxWorkspaceEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) => {
        const workspace = store.workspace(params.workspaceId)

        if (!workspace) {
          return notFound()
        }

        if (workspace.kind !== 'sandbox') {
          return conflict('Only the Sandbox Workspace can be reset')
        }

        const reset = { ...workspace, lastResetAt: new Date().toISOString() }
        store.setWorkspace(reset)

        return HttpResponse.json(reset)
      }),
    ),
  ]
}
