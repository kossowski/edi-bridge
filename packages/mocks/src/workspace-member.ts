import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type Session,
  type WorkspaceMember,
  workspaceMemberSchema,
  workspaceMembersEndpoint,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { sandboxAdminSession, seedSession, showcaseViewerSession, toSessionStore } from './session'
import { type SessionStore, signedInOnly } from './session-access'

export function createWorkspaceMember(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return workspaceMemberSchema.parse({
    id: seedId(11, 0),
    name: 'Erik Lund',
    email: 'erik.lund@nordwind-handel.example',
    role: 'viewer',
    lastActivityAt: null,
    ...overrides,
  })
}

function sessionMember(session: Session, lastActivityAt: string) {
  return createWorkspaceMember({ ...session.user, role: session.role, lastActivityAt })
}

export type WorkspaceMembers =
  ReadonlyArray<WorkspaceMember> | ReadonlyMap<string, ReadonlyArray<WorkspaceMember>>

export type WorkspaceMemberStore = {
  get: (workspaceId: string) => ReadonlyArray<WorkspaceMember>
  add: (workspaceId: string, member: WorkspaceMember) => void
  remove: (workspaceId: string, userId: string) => boolean
  byEmail: (email: string) => WorkspaceMember | undefined
}

export const seedWorkspaceMembers: WorkspaceMembers = new Map([
  [
    seedSession.workspace.id,
    [
      sessionMember(seedSession, '2026-10-11T16:42:00.000Z'),
      createWorkspaceMember({
        id: seedId(11, 1),
        name: 'Mara Olsen',
        email: 'mara.olsen@nordwind-handel.example',
        role: 'admin',
        lastActivityAt: '2026-10-11T08:05:00.000Z',
      }),
      createWorkspaceMember({
        id: seedId(11, 2),
        name: 'Tobias Reuter',
        email: 'tobias.reuter@nordwind-handel.example',
        role: 'admin',
        lastActivityAt: '2026-09-29T13:17:00.000Z',
      }),
      createWorkspaceMember({
        id: seedId(11, 3),
        name: 'Lena Hoffmann',
        email: 'lena.hoffmann@nordwind-handel.example',
        role: 'viewer',
        lastActivityAt: '2026-07-14T10:48:00.000Z',
      }),
    ],
  ],
  [
    showcaseViewerSession.workspace.id,
    [
      sessionMember(showcaseViewerSession, '2026-10-11T19:03:00.000Z'),
      createWorkspaceMember({
        id: seedId(11, 4),
        name: 'Clara Weidner',
        email: 'clara.weidner@lindenhof-feinkost.example',
        role: 'admin',
        lastActivityAt: '2026-10-10T07:52:00.000Z',
      }),
      createWorkspaceMember({
        id: seedId(11, 5),
        name: 'Felix Brandt',
        email: 'felix.brandt@lindenhof-feinkost.example',
        role: 'viewer',
        lastActivityAt: '2026-09-24T14:31:00.000Z',
      }),
      createWorkspaceMember({
        id: seedId(11, 6),
        name: 'Nele Albers',
        email: 'nele.albers@lindenhof-feinkost.example',
        role: 'viewer',
        lastActivityAt: null,
      }),
    ],
  ],
  [
    sandboxAdminSession.workspace.id,
    [sessionMember(sandboxAdminSession, '2026-10-10T11:26:00.000Z')],
  ],
])

function generateWorkspaceMember(faker: Faker, now: Date): WorkspaceMember {
  const firstName = faker.person.firstName()
  const lastName = faker.person.lastName()

  return createWorkspaceMember({
    id: faker.string.uuid(),
    name: `${firstName} ${lastName}`,
    email: faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase(),
    role: faker.datatype.boolean(0.2) ? 'admin' : 'viewer',
    lastActivityAt: faker.datatype.boolean(0.15)
      ? null
      : faker.date.recent({ days: 120, refDate: now }).toISOString(),
  })
}

const generatedMembersReferenceDate = new Date('2026-10-11T12:00:00.000Z')

export function createWorkspaceMembers({
  count,
  now = generatedMembersReferenceDate,
  seed = 69,
}: {
  count: number
  now?: Date
  seed?: number
}): WorkspaceMember[] {
  const faker = new Faker({ locale: [en], seed })
  const byEmail = new Map<string, WorkspaceMember>()

  while (byEmail.size < count) {
    const member = generateWorkspaceMember(faker, now)

    if (!byEmail.has(member.email)) {
      byEmail.set(member.email, member)
    }
  }

  return [...byEmail.values()]
}

export function createWorkspaceMemberStore(
  members: WorkspaceMembers = seedWorkspaceMembers,
): WorkspaceMemberStore {
  const added = new Map<string, WorkspaceMember[]>()
  const removed = new Set<string>()

  const removalKey = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`

  const seeded = (workspaceId: string) =>
    'get' in members ? (members.get(workspaceId) ?? []) : members

  const all = () => [
    ...('get' in members ? [...members.values()].flat() : members),
    ...[...added.values()].flat(),
  ]

  const get = (workspaceId: string) =>
    [...seeded(workspaceId), ...(added.get(workspaceId) ?? [])].filter(
      ({ id }) => !removed.has(removalKey(workspaceId, id)),
    )

  return {
    get,
    add: (workspaceId, member) => {
      removed.delete(removalKey(workspaceId, member.id))
      added.set(workspaceId, [...(added.get(workspaceId) ?? []), member])
    },
    remove: (workspaceId, userId) => {
      if (!get(workspaceId).some(({ id }) => id === userId)) {
        return false
      }

      removed.add(removalKey(workspaceId, userId))

      return true
    },
    byEmail: (email) => all().find((member) => member.email === email),
  }
}

export function toWorkspaceMemberStore(
  members: WorkspaceMembers | WorkspaceMemberStore = seedWorkspaceMembers,
): WorkspaceMemberStore {
  return 'add' in members ? members : createWorkspaceMemberStore(members)
}

export function workspaceMemberHandlers(
  apiUrl: string,
  {
    members = seedWorkspaceMembers,
    session = seedSession,
  }: {
    members?: WorkspaceMembers | WorkspaceMemberStore
    session?: Session | null | SessionStore
  } = {},
) {
  const store = toWorkspaceMemberStore(members)
  const sessionStore = toSessionStore(session)

  return [
    http.get(
      `${apiUrl}${workspaceMembersEndpoint.path}`,
      signedInOnly(sessionStore, (_, { workspace }) => HttpResponse.json(store.get(workspace.id))),
    ),
  ]
}
