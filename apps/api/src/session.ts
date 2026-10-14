import { asc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { FastifyRequest } from 'fastify'

import { memberships, users } from '@edi-bridge/db'

import type { Session, SessionUser, WorkspaceRole } from '@edi-bridge/contracts'

import { type Auth, headersOf } from './auth.js'
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

  // Until a session names its Workspace, a member enters the Workspace they joined first.
  const [membership] = await database
    .select({
      operator: users.operator,
      workspaceId: memberships.workspaceId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.userId, signedIn.user.id))
    .orderBy(asc(memberships.createdAt))
    .limit(1)

  if (membership === undefined) {
    return undefined
  }

  const { id, name, email } = signedIn.user

  return { user: { id, name, email }, ...membership }
}

export const loadSession = Effect.gen(function* () {
  const { user, operator, role } = yield* CurrentMember
  const { id, name } = yield* loadCurrentWorkspace

  return { user, operator, workspace: { id, name, kind: 'standard' }, role } satisfies Session
})
