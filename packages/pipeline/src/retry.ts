import { and, eq, isNotNull, or } from 'drizzle-orm'
import { Effect } from 'effect'

import { runs, runSteps } from '@edi-bridge/db'

import { RunNotRetryable } from './errors'
import { queueOrLeaveToSweep } from './queue-received-runs'
import { Database, type QueuedRun } from './services'

// The Run goes back to received with its earlier steps succeeded, so the worker repeats only the delivery.
export const retryRun = (queued: QueuedRun) =>
  Effect.gen(function* () {
    const db = yield* Database

    const reopened = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [run] = await tx
          .update(runs)
          .set({
            status: 'received',
            failureStage: null,
            error: null,
            problem: null,
            waitingForTradingPartnerSince: null,
          })
          .where(
            and(
              eq(runs.workspaceId, queued.workspaceId),
              eq(runs.id, queued.runId),
              eq(runs.status, 'failed'),
              eq(runs.failureStage, 'delivery'),
              // A Run that failed before delivery inputs were stored has nothing to deliver.
              or(isNotNull(runs.output), isNotNull(runs.deliveryInput)),
            ),
          )
          .returning({ id: runs.id })

        if (run === undefined) {
          return false
        }

        await tx
          .update(runSteps)
          .set({ status: 'pending', startedAt: null, finishedAt: null })
          .where(and(eq(runSteps.runId, run.id), eq(runSteps.stage, 'delivery')))

        return true
      }),
    )

    if (!reopened) {
      return yield* new RunNotRetryable({ runId: queued.runId })
    }

    yield* queueOrLeaveToSweep(queued, 'Retried')
  })
