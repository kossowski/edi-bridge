import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

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
