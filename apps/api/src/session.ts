import { and, asc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { FastifyRequest } from 'fastify'

import { members, users, workspaces } from '@edi-bridge/db'

import type { Session, SessionUser, WorkspaceRole } from '@edi-bridge/contracts'

import { type Auth, headersOf } from './auth.js'
import { type Database, Db } from './db.js'
import { Forbidden } from './errors.js'
import { exactlyOne } from './rows.js'
import { showcaseViewer } from './showcase-and-sandbox.js'
import { showcaseViewerRule } from './showcase-sign-in.js'

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

// The shared Viewer's session lasts only while it gives no more than a read-only view of the Showcase.
async function signedInSession(auth: Auth, database: Database, request: FastifyRequest) {
  const signedIn = await auth.api.getSession({ headers: headersOf(request) })

  if (signedIn?.user.email !== showcaseViewer.email) {
    return signedIn
  }

  const rule = await showcaseViewerRule(database)

  return rule.holds && rule.userId === signedIn.user.id ? signedIn : null
}

export async function resolveUser(
  auth: Auth,
  database: Database,
  request: FastifyRequest,
): Promise<SignedInUser | undefined> {
  const signedIn = await signedInSession(auth, database, request)

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
  const signedIn = await signedInSession(auth, database, request)

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
  const { user, operator, workspaceId, role } = yield* CurrentMember
  const db = yield* Db

  const rows = yield* Effect.promise(() =>
    db
      .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
  )

  const workspace = yield* exactlyOne(rows)

  return { user, operator, workspace, role } satisfies Session
})

export const requireChangeRight = Effect.gen(function* () {
  const { operator, role } = yield* CurrentMember

  if (!operator && role !== 'admin') {
    return yield* new Forbidden()
  }
})

// Only the Operator changes what a Workspace may spend, so a shared login can't raise its own AI budget.
export const requireOperatorRight = Effect.gen(function* () {
  const { operator } = yield* CurrentMember

  if (!operator) {
    return yield* new Forbidden()
  }
})
