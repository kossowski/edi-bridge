import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { runs } from '@edi-bridge/db'

import { Database, type QueuedRun, RunQueue } from './services'

export const queueReceivedRuns = Effect.gen(function* () {
  const db = yield* Database
  const queue = yield* RunQueue

  const received = yield* Effect.promise(() =>
    db
      .select({ workspaceId: runs.workspaceId, runId: runs.id })
      .from(runs)
      .where(eq(runs.status, 'received')),
  )

  yield* Effect.forEach(received, (run) => queue.enqueue(run), { discard: true })
})

// The sweep of received Runs queues a Run that is not queued here.
export const queueOrLeaveToSweep = (run: QueuedRun, which: 'Retried' | 'Reprocessed' | 'Stuck') =>
  Effect.gen(function* () {
    const queue = yield* RunQueue

    yield* queue
      .enqueue(run)
      .pipe(
        Effect.catchTag('RunNotQueued', (error) =>
          Effect.logWarning(`${which} Run not queued until the next sweep`, error),
        ),
      )
  })
