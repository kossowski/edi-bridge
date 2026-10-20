import { and, eq, exists, lte, sql } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import { runs, tradingPartners } from '@edi-bridge/db'

import { publishRunChanges } from './live-events'
import { Database } from './services'

export const markOverdueInterchanges = Effect.gen(function* () {
  const db = yield* Database
  const now = yield* DateTime.nowAsDate

  const marked = yield* Effect.promise(() =>
    db
      .update(runs)
      .set({ acknowledgementState: 'overdue' })
      .where(
        and(
          eq(runs.acknowledgementState, 'pending'),
          exists(
            db
              .select()
              .from(tradingPartners)
              .where(
                and(
                  eq(tradingPartners.id, runs.tradingPartnerId),
                  lte(
                    sql`${runs.handedOverAt} + make_interval(hours => ${tradingPartners.acknowledgementTimeLimitHours})`,
                    sql`${now.toISOString()}::timestamptz`,
                  ),
                ),
              ),
          ),
        ),
      )
      .returning({ id: runs.id }),
  )

  yield* publishRunChanges(marked.map(({ id }) => id))
})
