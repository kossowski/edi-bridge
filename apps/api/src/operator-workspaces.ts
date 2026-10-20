import { and, count, eq, gt, isNull, max, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { invites, members, runs, workspaces } from '@edi-bridge/db'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

import { Db } from './db.js'
import { startOfUtcDay } from './duration.js'
import { byName } from './rows.js'

const latest = (...dates: (Date | null | undefined)[]) =>
  dates.reduce<Date | null>(
    (last, date) => (date != null && (last === null || date > last) ? date : last),
    null,
  )

const loadSummaries = (workspaceId?: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = new Date()

    const of = (column: typeof workspaces.id) =>
      workspaceId === undefined ? undefined : eq(column, workspaceId)

    const [rows, memberRows, inviteRows, runRows] = yield* Effect.promise(() =>
      Promise.all([
        db.select().from(workspaces).where(of(workspaces.id)),
        db
          .select({
            workspaceId: members.workspaceId,
            count: count(),
            lastActivityAt: max(members.lastActivityAt),
          })
          .from(members)
          .where(of(members.workspaceId))
          .groupBy(members.workspaceId),
        db
          .select({ workspaceId: invites.workspaceId, count: count() })
          .from(invites)
          .where(
            and(
              of(invites.workspaceId),
              isNull(invites.acceptedAt),
              isNull(invites.revokedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .groupBy(invites.workspaceId),
        db
          .select({
            workspaceId: runs.workspaceId,
            today:
              sql<number>`count(*) filter (where ${runs.receivedAt} >= ${startOfUtcDay(now.getTime()).toISOString()}::timestamptz)`.mapWith(
                Number,
              ),
            lastReceivedAt: max(runs.receivedAt),
          })
          .from(runs)
          .where(of(runs.workspaceId))
          .groupBy(runs.workspaceId),
      ]),
    )

    const byWorkspace = <Row extends { workspaceId: string }>(found: Row[]) =>
      new Map(found.map((row) => [row.workspaceId, row]))

    const membersOf = byWorkspace(memberRows)
    const invitesOf = byWorkspace(inviteRows)
    const runsOf = byWorkspace(runRows)

    return rows.map((row): WorkspaceSummary => {
      const member = membersOf.get(row.id)
      const run = runsOf.get(row.id)

      return {
        id: row.id,
        name: row.name,
        gln: row.gln,
        kind: row.kind,
        seeded: row.seeded,
        memberCount: member?.count ?? 0,
        pendingInviteCount: invitesOf.get(row.id)?.count ?? 0,
        documentsToday: run?.today ?? 0,
        lastActivityAt: latest(member?.lastActivityAt, run?.lastReceivedAt)?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        lastResetAt: row.lastResetAt?.toISOString() ?? null,
      }
    })
  })

export const listWorkspaceSummaries = Effect.map(loadSummaries(), (summaries) =>
  summaries.sort(byName),
)
