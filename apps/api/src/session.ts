import { asc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { FastifyRequest } from 'fastify'

import { members, users } from '@edi-bridge/db'

import type { Session, SessionUser, WorkspaceRole } from '@edi-bridge/contracts'

import { type Auth, headersOf } from './auth.js'
import { Forbidden } from './errors.js'
import { loadCurrentWorkspace } from './workspace.js'

import type { Database } from './db.js'

export interface Member {
  readonly user: SessionUser
  readonly operator: boolean
  readonly workspaceId: string
  readonly role: WorkspaceRole
}

export class CurrentMember extends Context.Service<CurrentMember, Member>()('CurrentMember') {}

export async function resolveMember(
  auth: Auth,
  database: Database,
  request: FastifyRequest,
): Promise<Member | undefined> {
  const signedIn = await auth.api.getSession({ headers: headersOf(request) })

  if (!signedIn) {
    return undefined
  }

  // Until a session names its Workspace, a Member enters the Workspace they joined first.
  const [found] = await database
    .select({
      operator: users.operator,
      workspaceId: members.workspaceId,
      role: members.role,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.userId, signedIn.user.id))
    .orderBy(asc(members.createdAt))
    .limit(1)

  if (found === undefined) {
    return undefined
  }

  const { id, name, email } = signedIn.user

  return { user: { id, name, email }, ...found }
}

export const loadSession = Effect.gen(function* () {
  const { user, operator, role } = yield* CurrentMember
  const { id, name } = yield* loadCurrentWorkspace

  return { user, operator, workspace: { id, name, kind: 'standard' }, role } satisfies Session
})

export const requireChangeRight = Effect.gen(function* () {
  const { operator, role } = yield* CurrentMember

  if (!operator && role !== 'admin') {
    return yield* new Forbidden()
  }
})
