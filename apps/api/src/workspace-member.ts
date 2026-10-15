import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { members, sessions, users } from '@edi-bridge/db'

import type { WorkspaceMember } from '@edi-bridge/contracts'

import { Db } from './db.js'
import { Conflict, NotFound } from './errors.js'
import { byName, rejectingInvalidId } from './rows.js'
import { CurrentUser } from './session.js'
import { CurrentWorkspace, requireWorkspace } from './workspace.js'

const listMembers = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    const rows = yield* Effect.promise(() =>
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: members.role,
          lastActivityAt: members.lastActivityAt,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.workspaceId, workspaceId)),
    )

    return rows
      .map((row): WorkspaceMember => ({
        ...row,
        lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      }))
      .sort(byName)
  })

export const listCurrentMembers = Effect.flatMap(CurrentWorkspace, ({ id }) => listMembers(id))

export const listWorkspaceMembers = (workspaceId: string) =>
  Effect.andThen(requireWorkspace(workspaceId), listMembers(workspaceId))

export const removeWorkspaceMember = (workspaceId: string, userId: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(workspaceId)
    yield* rejectingInvalidId(userId)

    const { user } = yield* CurrentUser

    if (user.id === userId) {
      return yield* new Conflict({ message: 'The Operator cannot remove themselves' })
    }

    const db = yield* Db

    // Ending every session signs the removed user out instead of leaving them with a dead one.
    const removed = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const rows = await tx
          .delete(members)
          .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
          .returning({ userId: members.userId })

        if (rows.length > 0) {
          await tx.delete(sessions).where(eq(sessions.userId, userId))
        }

        return rows.length > 0
      }),
    )

    if (!removed) {
      return yield* new NotFound()
    }
  })
