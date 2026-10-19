import { and, eq, gte, lt, ne, notExists, or } from 'drizzle-orm'
import { DateTime, type Duration, Effect } from 'effect'

import { runs, runSteps } from '@edi-bridge/db'

import { failOnDefect } from './process-run'
import { queueOrLeaveToSweep } from './queue-received-runs'
import { Database } from './services'

// A Run is stuck once neither it nor any of its steps changed within the bound.
export const sweepStuckRuns = (stuckAfter: Duration.Input) =>
  Effect.gen(function* () {
    const db = yield* Database

    const cutoff = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, stuckAfter))

    const stuck = yield* Effect.promise(() =>
      db
        .select({ workspaceId: runs.workspaceId, runId: runs.id })
        .from(runs)
        .where(
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
          ),
        ),
    )

    yield* Effect.forEach(stuck, (run) => releaseOrFail(run, cutoff), { discard: true })
  })

const releaseOrFail = (run: { workspaceId: string; runId: string }, cutoff: Date) =>
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
            eq(runs.status, 'processing'),
            lt(runs.updatedAt, cutoff),
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
      yield* queueOrLeaveToSweep(run, 'Stuck')

      return
    }

    yield* Effect.logError(`Stuck Run ${run.runId} failed as a defect`)
    yield* failOnDefect(run.runId)
  })
