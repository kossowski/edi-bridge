import { eq, inArray, lte, sql } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import { documents, runs, workspaces } from '@edi-bridge/db'

import { Database } from './services'

// The Runs lose their Document first, so its deletion leaves no Run without the time it expired.
export const deleteExpiredDocuments = Effect.gen(function* () {
  const db = yield* Database
  const now = yield* DateTime.nowAsDate

  yield* Effect.promise(() =>
    db.transaction(async (tx) => {
      const expired = tx
        .select({ id: documents.id })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(
          lte(
            sql`${documents.receivedAt} + make_interval(days => ${workspaces.documentRetentionDays})`,
            sql`${now.toISOString()}::timestamptz`,
          ),
        )

      await tx
        .update(runs)
        .set({ documentId: null, documentDeletedAt: now })
        .where(inArray(runs.documentId, expired))

      await tx.delete(documents).where(inArray(documents.id, expired))
    }),
  )
})
