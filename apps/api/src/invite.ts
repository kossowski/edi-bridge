import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { Effect } from 'effect'
import { randomBytes } from 'node:crypto'

import {
  type AcceptInviteInput,
  type Invite,
  type InviteInput,
  inviteValidityDays,
} from '@edi-bridge/contracts'
import { invites, workspaces } from '@edi-bridge/db'

import { Db } from './db.js'
import { Conflict, Forbidden, InviteUnusable, NotFound } from './errors.js'
import { exactlyOne, foundOrNotFound, rejectingInvalidId } from './rows.js'
import { addUser, findUserWithPassword, grantRole, storePassword } from './user.js'

import type { ValidationError } from './parse.js'

const dayMs = 24 * 60 * 60 * 1000

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

const requireWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(workspaceId)

    const db = yield* Db

    const rows = yield* Effect.promise(() =>
      db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)),
    )

    yield* foundOrNotFound(rows[0])
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

    const { email, role } = yield* input
    const db = yield* Db
    const createdAt = new Date()

    const rows = yield* Effect.promise(() =>
      db
        .insert(invites)
        .values({
          workspaceId,
          email: email.trim().toLowerCase(),
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

function unusableReason({ acceptedAt, revokedAt, expiresAt }: InviteRow, now: Date) {
  if (revokedAt !== null) {
    return 'This invite was revoked.'
  }

  if (acceptedAt !== null) {
    return 'This invite was already used.'
  }

  return expiresAt <= now ? 'This invite has expired.' : undefined
}

export const acceptInvite = (
  token: string,
  input: Effect.Effect<AcceptInviteInput, ValidationError>,
) =>
  Effect.gen(function* () {
    const { name, password } = yield* input
    const db = yield* Db
    const now = new Date()

    const [invite] = yield* Effect.promise(() =>
      db.select().from(invites).where(eq(invites.token, token)),
    )

    if (invite === undefined) {
      return yield* new NotFound()
    }

    const reason = unusableReason(invite, now)

    if (reason !== undefined) {
      return yield* new InviteUnusable({ message: reason })
    }

    const existing = yield* Effect.promise(() => findUserWithPassword(db, invite.email))

    if (existing !== undefined) {
      const { passwordHash } = existing

      const matches =
        passwordHash !== null &&
        (yield* Effect.promise(() => verifyPassword({ hash: passwordHash, password })))

      if (!matches) {
        return yield* new Forbidden()
      }
    }

    const newPasswordHash =
      existing === undefined ? yield* Effect.promise(() => hashPassword(password)) : undefined

    const accepted = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const claimed = await tx
          .update(invites)
          .set({ acceptedAt: now })
          .where(
            and(
              eq(invites.id, invite.id),
              isNull(invites.acceptedAt),
              isNull(invites.revokedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .returning({ id: invites.id })

        if (claimed.length === 0) {
          return false
        }

        const userId =
          existing?.id ?? (await addUser(tx, { name, email: invite.email, operator: false }))

        if (newPasswordHash !== undefined) {
          await storePassword(tx, userId, newPasswordHash)
        }

        await grantRole(tx, { userId, workspaceId: invite.workspaceId, role: invite.role })

        return true
      }),
    )

    if (!accepted) {
      return yield* new InviteUnusable({ message: 'This invite is no longer open.' })
    }
  })
