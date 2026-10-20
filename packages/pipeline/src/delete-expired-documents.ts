import { and, asc, eq, inArray, lte, notExists, sql } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import {
  channels,
  type Connection,
  documents,
  runs,
  type Transaction,
  workspaces,
} from '@edi-bridge/db'

import { Database } from './services'

// Keeps the first sweep after a deploy from deleting a backlog in one huge transaction.
const batchSize = 500

// The processing of a Run in flight still reads its Document.
const noRunInFlight = (tx: Transaction) =>
  notExists(
    tx
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(eq(runs.documentId, documents.id), inArray(runs.status, ['received', 'processing'])),
      ),
  )

const deleteBatch = (db: Connection['db'], now: Date, size: number) =>
  db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
      .innerJoin(channels, eq(channels.id, documents.channelId))
      .where(
        and(
          // The seeded-traffic guard on a Run reads the source Channel of its Document.
          eq(channels.seeded, false),
          lte(
            sql`${documents.receivedAt} + make_interval(days => ${workspaces.documentRetentionDays})`,
            sql`${now.toISOString()}::timestamptz`,
          ),
          noRunInFlight(tx),
        ),
      )
      .orderBy(asc(documents.id))
      .limit(size)

    if (candidates.length === 0) {
      return 0
    }

    const candidateIds = candidates.map(({ id }) => id)

    // A Reprocess locks its replaced Run before it inserts the new Run, so the sweep locks the Runs first too.
    await tx
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.documentId, candidateIds))
      .orderBy(asc(runs.id))
      .for('update')

    // A Reprocess committed before the Runs were locked may have started a new Run in flight.
    const locked = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(inArray(documents.id, candidateIds), noRunInFlight(tx)))
      .for('update')

    const ids = locked.map(({ id }) => id)

    if (ids.length > 0) {
      // The Runs lose their Document first, so its deletion leaves no Run without the time it expired.
      await tx
        .update(runs)
        .set({ documentId: null, documentDeletedAt: now })
        .where(inArray(runs.documentId, ids))

      await tx.delete(documents).where(inArray(documents.id, ids))
    }

    return candidates.length
  })

export const deleteExpiredDocumentsInBatchesOf = (size: number) =>
  Effect.gen(function* () {
    const db = yield* Database
    const now = yield* DateTime.nowAsDate

    yield* Effect.promise(() => deleteBatch(db, now, size)).pipe(
      Effect.repeat({ while: (deleted) => deleted === size }),
    )
  })

export const deleteExpiredDocuments = deleteExpiredDocumentsInBatchesOf(batchSize)
