import { and, eq, gte, lt, ne, notExists, or } from 'drizzle-orm'
import { DateTime, type Duration, Effect } from 'effect'

import { runs, runSteps } from '@edi-bridge/db'

import { type DefectReport, reportFoundDefect } from './defect-report'
import { publishRunChanges } from './live-events'
import { failOnDefect } from './process-run'
import { queueOrLeaveToSweep } from './queue-received-runs'
import { Database } from './services'

type Db = Database['Service']

// A Run is stuck once neither it nor any of its steps changed within the bound.
const isStuck = (db: Db, cutoff: Date) =>
  and(
    eq(runs.status, 'processing'),
    lt(runs.updatedAt, cutoff),
    notExists(
      db
        .select()
        .from(runSteps)
        .where(
          and(
            eq(runSteps.runId, runs.id),
            or(gte(runSteps.startedAt, cutoff), gte(runSteps.finishedAt, cutoff)),
          ),
        ),
    ),
  )

export const sweepStuckRuns = (stuckAfter: Duration.Input) =>
  Effect.gen(function* () {
    const db = yield* Database

    const cutoff = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, stuckAfter))

    const stuck = yield* Effect.promise(() =>
      db
        .select({
          workspaceId: runs.workspaceId,
          runId: runs.id,
          tradingPartnerId: runs.tradingPartnerId,
        })
        .from(runs)
        .where(isStuck(db, cutoff)),
    )

    yield* Effect.forEach(stuck, (run) => releaseOrFail(run, cutoff), { discard: true })
  })

type StuckRun = Omit<DefectReport, 'channelId' | 'code' | 'cause'>

// A stuck Run is a defect either way: its worker died or stalled past the bound.
const releaseOrFail = ({ tradingPartnerId, ...run }: StuckRun, cutoff: Date) =>
  Effect.gen(function* () {
    const db = yield* Database

    // A Run whose steps after receipt never started lost nothing, so it is processed again.
    const [released] = yield* Effect.promise(() =>
      db
        .update(runs)
        .set({ status: 'received' })
        .where(
          and(
            eq(runs.id, run.runId),
            isStuck(db, cutoff),
            notExists(
              db
                .select()
                .from(runSteps)
                .where(
                  and(
                    eq(runSteps.runId, runs.id),
                    ne(runSteps.stage, 'receipt'),
                    ne(runSteps.status, 'pending'),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: runs.id }),
    )

    if (released !== undefined) {
      yield* Effect.logError(`Stuck Run ${run.runId} released to be processed again`)
      yield* publishRunChanges([run.runId])
      yield* queueOrLeaveToSweep(run, 'Stuck')

      return
    }

    if (yield* failOnDefect(run.runId)) {
      yield* reportFoundDefect(`Stuck Run ${run.runId} failed as a defect`, {
        ...run,
        tradingPartnerId,
      })
      yield* publishRunChanges([run.runId])
    }
  })
