import { and, asc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { FastifyRequest } from 'fastify'

import { members, users } from '@edi-bridge/db'

import type { Session, SessionUser, WorkspaceRole } from '@edi-bridge/contracts'

import { type Auth, headersOf } from './auth.js'
import { type Database, Db } from './db.js'
import { Forbidden } from './errors.js'
import { loadCurrentWorkspace } from './workspace.js'

export interface Member {
  readonly user: SessionUser
  readonly operator: boolean
  readonly workspaceId: string
  readonly role: WorkspaceRole
  readonly lastActivityAt: Date | null
}

export interface SignedInUser {
  readonly user: SessionUser
  readonly operator: boolean
}

export class CurrentUser extends Context.Service<CurrentUser, SignedInUser>()('CurrentUser') {}

export async function resolveUser(
  auth: Auth,
  database: Database,
  request: FastifyRequest,
): Promise<SignedInUser | undefined> {
  const signedIn = await auth.api.getSession({ headers: headersOf(request) })

  if (!signedIn) {
    return undefined
  }

  const [found] = await database
    .select({ operator: users.operator })
    .from(users)
    .where(eq(users.id, signedIn.user.id))

  if (found === undefined) {
    return undefined
  }

  const { id, name, email } = signedIn.user

  return { user: { id, name, email }, operator: found.operator }
}

export const requireOperator = Effect.gen(function* () {
  const { operator } = yield* CurrentUser

  if (!operator) {
    return yield* new Forbidden()
  }
})

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
      lastActivityAt: members.lastActivityAt,
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

const activityInterval = 60_000

// Writes at most once a minute per Member, so a burst of requests costs one update.
export const recordActivity = Effect.gen(function* () {
  const { user, workspaceId, lastActivityAt } = yield* CurrentMember
  const now = new Date()

  if (lastActivityAt !== null && now.getTime() - lastActivityAt.getTime() < activityInterval) {
    return
  }

  const db = yield* Db

  yield* Effect.promise(() =>
    db
      .update(members)
      .set({ lastActivityAt: now })
      .where(and(eq(members.userId, user.id), eq(members.workspaceId, workspaceId))),
  )
})

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
