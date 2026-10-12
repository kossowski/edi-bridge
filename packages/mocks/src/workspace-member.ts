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
    id: seedId(11, 1),
    name: 'Mara Olsen',
    email: 'mara.olsen@nordwind-handel.example',
    role: 'viewer',
    lastActivityAt: null,
    ...overrides,
  })
}

function sessionMember(session: Session, lastActivityAt: string) {
  return createWorkspaceMember({ ...session.user, role: session.role, lastActivityAt })
}

export const seedWorkspaceMembers: ReadonlyMap<string, ReadonlyArray<WorkspaceMember>> = new Map([
  [
    seedSession.workspace.id,
    [
      sessionMember(seedSession, '2026-10-11T16:42:00.000Z'),
      createWorkspaceMember({ role: 'admin', lastActivityAt: '2026-10-11T08:05:00.000Z' }),
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
    [sessionMember(showcaseViewerSession, '2026-10-11T19:03:00.000Z')],
  ],
  [
    sandboxAdminSession.workspace.id,
    [sessionMember(sandboxAdminSession, '2026-10-10T11:26:00.000Z')],
  ],
])

function generateWorkspaceMember(faker: Faker, now: Date): WorkspaceMember {
  const firstName = faker.person.firstName()
  const lastName = faker.person.lastName()

  return {
    id: faker.string.uuid(),
    name: `${firstName} ${lastName}`,
    email: faker.internet.email({ firstName, lastName, provider: 'example.com' }).toLowerCase(),
    role: faker.datatype.boolean(0.2) ? 'admin' : 'viewer',
    lastActivityAt: faker.datatype.boolean(0.15)
      ? null
      : faker.date.recent({ days: 120, refDate: now }).toISOString(),
  }
}

export function createWorkspaceMembers({
  count,
  now = new Date(),
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
      byEmail.set(member.email, workspaceMemberSchema.parse(member))
    }
  }

  return [...byEmail.values()]
}

export function workspaceMemberHandlers(
  apiUrl: string,
  {
    members = seedWorkspaceMembers,
    session = seedSession,
  }: {
    members?: ReadonlyArray<WorkspaceMember> | ReadonlyMap<string, ReadonlyArray<WorkspaceMember>>
    session?: Session | null | SessionStore
  } = {},
) {
  const sessionStore = toSessionStore(session)

  const membersOf = (workspaceId: string) =>
    'get' in members ? (members.get(workspaceId) ?? []) : members

  return [
    http.get(
      `${apiUrl}${workspaceMembersEndpoint.path}`,
      signedInOnly(sessionStore, (_, { workspace }) => HttpResponse.json(membersOf(workspace.id))),
    ),
  ]
}
