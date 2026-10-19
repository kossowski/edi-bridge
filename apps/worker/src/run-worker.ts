import { Worker } from 'bullmq'
import { Effect } from 'effect'
import { Redis } from 'ioredis'

import { type Connection, postgresDocumentStorage } from '@edi-bridge/db'
import {
  bullmqRunQueue,
  Database,
  Documents,
  processRun,
  type QueuedRun,
  queueReceivedRuns,
  RunQueue,
  runQueueName,
} from '@edi-bridge/pipeline'

export function startRunWorker({ redisUrl, db }: { redisUrl: string; db: Connection['db'] }) {
  // BullMQ blocks on its worker connection, so commands must wait for a reconnect, not fail.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const documents = postgresDocumentStorage(db)
  const queue = bullmqRunQueue(redisUrl)

  const worker = new Worker<QueuedRun>(
    runQueueName,
    ({ data }) =>
      Effect.runPromise(
        processRun(data).pipe(
          Effect.provideService(Database, db),
          Effect.provideService(Documents, documents),
        ),
      ),
    { connection: redis },
  )

  const queuedReceivedRuns = Effect.runPromiseExit(
    queueReceivedRuns.pipe(
      Effect.provideService(Database, db),
      Effect.provideService(RunQueue, queue.service),
    ),
  )

  return {
    worker,
    queuedReceivedRuns,
    close: async () => {
      await queuedReceivedRuns
      await Promise.all([worker.close(), queue.close()])
      redis.disconnect()
    },
  }
}
