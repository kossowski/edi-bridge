import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  acceptInviteEndpoint,
  createInviteEndpoint,
  createWorkspaceEndpoint,
  type Invite,
  inviteSchema,
  inviteUnusableReason,
  inviteValidityDays,
  operatorWorkspaceMembersEndpoint,
  removeWorkspaceMemberEndpoint,
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
import { badRequest, conflict, forbidden, inviteUnusable, notFound } from './responses'
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
  createWorkspaceMember,
  seedWorkspaceMembers,
  toWorkspaceMemberStore,
  type WorkspaceMembers,
  type WorkspaceMemberStore,
} from './workspace-member'

export type WorkspaceSummaryRecord = Omit<WorkspaceSummary, 'pendingInviteCount'>

const workspaceSummaryRecordSchema = workspaceSummarySchema.omit({ pendingInviteCount: true })

export const seedWorkspaceSummaries: ReadonlyArray<WorkspaceSummaryRecord> = [
  {
    ...seedWorkspace,
    kind: 'standard',
    memberCount: 4,
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
    documentsToday: 12,
    lastActivityAt: '2026-10-10T11:26:00.000Z',
    seeded: true,
    createdAt: '2026-02-02T08:05:00.000Z',
    lastResetAt: '2026-10-09T17:45:00.000Z',
  },
].map((workspace) => workspaceSummaryRecordSchema.parse(workspace))

function generateWorkspaceSummary(faker: Faker, now: Date): WorkspaceSummaryRecord {
  const createdAt = faker.date.past({ years: 3, refDate: now })
  const quiet = faker.datatype.boolean(0.15)

  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: faker.datatype.boolean(0.85) ? randomGln(faker) : null,
    kind: 'standard',
    memberCount: faker.number.int({ min: 0, max: 40 }),
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
}): WorkspaceSummaryRecord[] {
  const faker = new Faker({ locale: [en], seed })
  const byName = new Map<string, WorkspaceSummaryRecord>()

  while (byName.size < count) {
    const workspace = generateWorkspaceSummary(faker, now)

    if (!byName.has(workspace.name)) {
      byName.set(workspace.name, workspaceSummaryRecordSchema.parse(workspace))
    }
  }

  return [...byName.values()]
}

export function newWorkspaceSummary(
  workspace: Workspace,
  { memberCount, seeded }: Pick<WorkspaceSummary, 'memberCount' | 'seeded'>,
): WorkspaceSummaryRecord {
  return {
    ...workspace,
    kind: 'standard',
    memberCount,
    documentsToday: 0,
    lastActivityAt: null,
    seeded,
    createdAt: new Date().toISOString(),
    lastResetAt: null,
  }
}

const defaultAppUrl = 'http://localhost:3000'

function invitePath(token: string) {
  return `/invite/${token}`
}

function inviteLink(appUrl: string, token: string) {
  return `${appUrl}${invitePath(token)}`
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

const seedLoadedAt = Date.now()

function daysBeforeSeedLoad(days: number) {
  return new Date(seedLoadedAt - days * dayMs).toISOString()
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
    createdAt: daysBeforeSeedLoad(1),
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
  {
    workspaceId: seedWorkspace.id,
    email: 'frieda.lange@nordwind-handel.example',
    role: 'viewer',
    createdAt: daysBeforeSeedLoad(inviteValidityDays + 3),
    acceptedAt: null,
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
  setWorkspace: (workspace: WorkspaceSummaryRecord) => void
  invites: (workspaceId: string) => readonly Invite[]
  invite: (workspaceId: string, inviteId: string) => Invite | undefined
  setInvite: (invite: Invite) => void
  inviteByToken: (token: string) => Invite | undefined
  now: () => Date
}

export function createOperatorStore({
  workspaces = seedWorkspaceSummaries,
  invites = seedInvites,
  now = () => new Date(),
}: {
  workspaces?: ReadonlyArray<WorkspaceSummaryRecord>
  invites?: ReadonlyArray<Invite>
  now?: () => Date
} = {}): OperatorStore {
  const byId = new Map(
    workspaces.map((workspace) => [workspace.id, workspaceSummaryRecordSchema.parse(workspace)]),
  )

  const invitesById = new Map(invites.map((invite) => [invite.id, invite]))

  const activeInvites = (workspaceId: string) =>
    [...invitesById.values()].filter(
      (invite) => invite.workspaceId === workspaceId && invite.revokedAt === null,
    )

  const pendingInviteCount = (workspaceId: string) => {
    const at = now().getTime()

    return activeInvites(workspaceId).filter(
      ({ acceptedAt, expiresAt }) => acceptedAt === null && Date.parse(expiresAt) > at,
    ).length
  }

  const summary = (workspace: WorkspaceSummaryRecord): WorkspaceSummary => ({
    ...workspace,
    pendingInviteCount: pendingInviteCount(workspace.id),
  })

  return {
    workspaces: () => [...byId.values()].map(summary),
    workspace: (id) => {
      const workspace = byId.get(id)

      return workspace && summary(workspace)
    },
    setWorkspace: (workspace) => {
      byId.set(workspace.id, workspaceSummaryRecordSchema.parse(workspace))
    },
    invites: (workspaceId) =>
      activeInvites(workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    invite: (workspaceId, inviteId) => {
      const invite = invitesById.get(inviteId)

      return invite?.workspaceId === workspaceId && invite.revokedAt === null ? invite : undefined
    },
    setInvite: (invite) => {
      invitesById.set(invite.id, invite)
    },
    inviteByToken: (token) =>
      [...invitesById.values()].find(({ link }) => new URL(link).pathname === invitePath(token)),
    now,
  }
}

export function toOperatorStore(
  workspaces: ReadonlyArray<WorkspaceSummaryRecord> | OperatorStore = seedWorkspaceSummaries,
  invites: ReadonlyArray<Invite> = seedInvites,
  now: () => Date = () => new Date(),
) {
  return 'workspace' in workspaces ? workspaces : createOperatorStore({ workspaces, invites, now })
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
    now,
  }: {
    workspaces?: ReadonlyArray<WorkspaceSummaryRecord> | OperatorStore
    invites?: ReadonlyArray<Invite>
    members?: WorkspaceMembers | WorkspaceMemberStore
    session?: Session | null | SessionStore
    appUrl?: string
    now?: () => Date
  } = {},
) {
  const store = toOperatorStore(workspaces, invites, now)
  const memberStore = toWorkspaceMemberStore(members)
  const sessionStore = toSessionStore(session)

  const passwords = new Map<string, string>(
    Object.values(mockCredentials).map(({ email, password }) => [email, password]),
  )

  const isMember = (workspaceId: string, email: string) =>
    memberStore.get(workspaceId).some((member) => member.email === email)

  // Seeded and generated summaries keep their own count until their member list changes.
  const countMembers = (workspaceId: string) => {
    const workspace = store.workspace(workspaceId)

    if (workspace) {
      store.setWorkspace({ ...workspace, memberCount: memberStore.get(workspaceId).length })
    }
  }

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

        store.setWorkspace(
          newWorkspaceSummary(
            { id, name, gln: seed ? randomGln(seededFaker(`workspace:${id}`)) : null },
            { memberCount: 0, seeded: seed },
          ),
        )

        return HttpResponse.json(store.workspace(id), { status: 201 })
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
    http.delete<{ workspaceId: string; userId: string }>(
      `${apiUrl}${removeWorkspaceMemberEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) => {
        if (params.userId === sessionStore.get()?.user.id) {
          return conflict('The Operator cannot remove themselves')
        }

        if (
          !store.workspace(params.workspaceId) ||
          !memberStore.remove(params.workspaceId, params.userId)
        ) {
          return notFound()
        }

        countMembers(params.workspaceId)

        return new HttpResponse(null, { status: 204 })
      }),
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
        if (!store.workspace(params.workspaceId)) {
          return notFound()
        }

        const body = createInviteEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const email = body.data.email.trim().toLowerCase()

        if (isMember(params.workspaceId, email)) {
          return conflict('This person is already a Member of the Workspace')
        }

        const invite = toInvite(
          {
            ...body.data,
            email,
            id: crypto.randomUUID(),
            workspaceId: params.workspaceId,
            createdAt: new Date().toISOString(),
            acceptedAt: null,
          },
          appUrl,
          crypto.randomUUID(),
        )

        store.setInvite(invite)

        return HttpResponse.json(invite, { status: 201 })
      }),
    ),
    http.delete<{ workspaceId: string; inviteId: string }>(
      `${apiUrl}${revokeInviteEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) => {
        const invite = store.invite(params.workspaceId, params.inviteId)

        if (!invite) {
          return notFound()
        }

        if (invite.acceptedAt !== null) {
          return conflict('An accepted invite cannot be revoked')
        }

        const revoked = { ...invite, revokedAt: new Date().toISOString() }
        store.setInvite(revoked)

        return HttpResponse.json(revoked)
      }),
    ),
    http.post(`${apiUrl}${acceptInviteEndpoint.path}`, async ({ request }) => {
      const body = acceptInviteEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const { token, name, password } = body.data
      const invite = store.inviteByToken(token)

      if (!invite) {
        return notFound()
      }

      const now = store.now()
      const reason = inviteUnusableReason(invite, now)

      if (reason) {
        return inviteUnusable(reason)
      }

      const existing = memberStore.byEmail(invite.email)
      const known = existing !== undefined || passwords.has(invite.email)

      if (known && passwords.get(invite.email) !== password) {
        return forbidden()
      }

      if (!isMember(invite.workspaceId, invite.email)) {
        memberStore.add(
          invite.workspaceId,
          createWorkspaceMember({
            id: existing?.id ?? crypto.randomUUID(),
            name: existing?.name ?? name,
            email: invite.email,
            role: invite.role,
            lastActivityAt: null,
          }),
        )

        countMembers(invite.workspaceId)
      }

      passwords.set(invite.email, password)
      store.setInvite({ ...invite, acceptedAt: now.toISOString() })

      return new HttpResponse(null, { status: 204 })
    }),
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
