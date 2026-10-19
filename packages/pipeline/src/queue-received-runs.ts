import { eq } from 'drizzle-orm'
import { type Duration, Effect, Schedule } from 'effect'

import { directionOf } from '@edi-bridge/contracts'
import { flows, runs } from '@edi-bridge/db'

import { Database, RunQueue } from './services'

export const queueReceivedRuns = Effect.gen(function* () {
  const db = yield* Database
  const queue = yield* RunQueue

  const received = yield* Effect.promise(() =>
    db
      .select({ workspaceId: runs.workspaceId, runId: runs.id, messageType: flows.messageType })
      .from(runs)
      .innerJoin(flows, eq(flows.id, runs.flowId))
      .where(eq(runs.status, 'received')),
  )

  // processRun claims only outbound Runs, so inbound ones stay out of the queue.
  yield* Effect.forEach(
    received.filter((run) => directionOf(run) === 'outbound'),
    ({ workspaceId, runId }) => queue.enqueue({ workspaceId, runId }),
    { discard: true },
  )
})

// A failed sweep leaves its Runs received, and the next one tries them again.
export const queueReceivedRunsEvery = (interval: Duration.Input) =>
  queueReceivedRuns.pipe(
    Effect.catchCause((cause) => Effect.logError('Received Runs not queued', cause)),
    Effect.repeat(Schedule.spaced(interval)),
  )
