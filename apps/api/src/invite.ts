import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { randomBytes } from 'node:crypto'

import {
  type AcceptInviteInput,
  type AcceptedInvite,
  type Invite,
  type InviteInput,
  inviteUnusableReason,
  inviteValidityDays,
} from '@edi-bridge/contracts'
import { invites, members, userEmailUnique, users } from '@edi-bridge/db'

import { Db, type Transaction } from './db.js'
import { dayMs } from './duration.js'
import { Conflict, Forbidden, InviteUnusable, NotFound } from './errors.js'
import { exactlyOne, foundOrNotFound, rejectingDuplicate, rejectingInvalidId } from './rows.js'
import { addMembership, addUser, findUserWithPassword, storePassword } from './user.js'
import { requireWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

type InviteRow = typeof invites.$inferSelect

const toInvite = (row: InviteRow, webOrigin: string): Invite => ({
  id: row.id,
  workspaceId: row.workspaceId,
  email: row.email,
  role: row.role,
  link: `${webOrigin}/invite/${row.token}`,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  acceptedAt: row.acceptedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
})

export const listInvites = (workspaceId: string, webOrigin: string) =>
  Effect.gen(function* () {
    yield* requireWorkspace(workspaceId)

    const db = yield* Db

    const rows = yield* Effect.promise(() =>
      db
        .select()
        .from(invites)
        .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.revokedAt)))
        .orderBy(desc(invites.createdAt)),
    )

    return rows.map((row) => toInvite(row, webOrigin))
  })

export const createInvite = (
  workspaceId: string,
  input: Effect.Effect<InviteInput, ValidationError>,
  webOrigin: string,
) =>
  Effect.gen(function* () {
    yield* requireWorkspace(workspaceId)

    const { email: rawEmail, role } = yield* input
    const email = rawEmail.trim().toLowerCase()
    const db = yield* Db

    const [member] = yield* Effect.promise(() =>
      db
        .select({ userId: members.userId })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.workspaceId, workspaceId), eq(users.email, email))),
    )

    if (member !== undefined) {
      return yield* new Conflict({ message: 'This person is already a Member of the Workspace' })
    }

    const createdAt = new Date()

    const rows = yield* Effect.promise(() =>
      db
        .insert(invites)
        .values({
          workspaceId,
          email,
          role,
          token: randomBytes(32).toString('base64url'),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + inviteValidityDays * dayMs),
        })
        .returning(),
    )

    return toInvite(yield* exactlyOne(rows), webOrigin)
  })

export const revokeInvite = (workspaceId: string, inviteId: string, webOrigin: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(workspaceId)
    yield* rejectingInvalidId(inviteId)

    const db = yield* Db

    const open = and(
      eq(invites.id, inviteId),
      eq(invites.workspaceId, workspaceId),
      isNull(invites.revokedAt),
    )

    const [found] = yield* Effect.promise(() =>
      db.select({ acceptedAt: invites.acceptedAt }).from(invites).where(open),
    )

    const { acceptedAt } = yield* foundOrNotFound(found)

    if (acceptedAt !== null) {
      return yield* new Conflict({ message: 'An accepted invite cannot be revoked' })
    }

    const rows = yield* Effect.promise(() =>
      db
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(open, isNull(invites.acceptedAt)))
        .returning(),
    )

    return toInvite(yield* foundOrNotFound(rows[0]), webOrigin)
  })

type Refusal = NotFound | InviteUnusable | Forbidden

const passwordMatches = async (hash: string | null, password: string) =>
  hash !== null && (await verifyPassword({ hash, password }))

async function addInvitedUser(
  tx: Transaction,
  { name, email, password }: { name: string; email: string; password: string },
) {
  const userId = await addUser(tx, { name, email, operator: false })
  await storePassword(tx, userId, await hashPassword(password))

  return userId
}

async function acceptInTransaction(
  tx: Transaction,
  { token, name, password }: AcceptInviteInput,
  now: Date,
): Promise<Refusal | AcceptedInvite> {
  const [invite] = await tx.select().from(invites).where(eq(invites.token, token)).for('update')

  if (invite === undefined) {
    return new NotFound()
  }

  const reason = inviteUnusableReason(invite, now)

  if (reason !== undefined) {
    return new InviteUnusable({ reason })
  }

  const existing = await findUserWithPassword(tx, invite.email)

  if (existing !== undefined && !(await passwordMatches(existing.passwordHash, password))) {
    return new Forbidden()
  }

  const userId = existing?.id ?? (await addInvitedUser(tx, { name, email: invite.email, password }))

  await addMembership(tx, { userId, workspaceId: invite.workspaceId, role: invite.role })
  await tx.update(invites).set({ acceptedAt: now }).where(eq(invites.id, invite.id))

  return { email: invite.email }
}

export const acceptInvite = (input: Effect.Effect<AcceptInviteInput, ValidationError>) =>
  Effect.gen(function* () {
    const accepted = yield* input
    const db = yield* Db
    const now = new Date()

    const outcome = yield* rejectingDuplicate(
      () => db.transaction((tx) => acceptInTransaction(tx, accepted, now)),
      [userEmailUnique],
      'An account with this email was created meanwhile',
    )

    if ('_tag' in outcome) {
      return yield* Effect.fail(outcome)
    }

    return outcome
  })
