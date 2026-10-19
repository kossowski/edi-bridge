import { Worker } from 'bullmq'
import { type Duration, Effect, Fiber } from 'effect'
import { Redis } from 'ioredis'

import { type Connection, postgresDocumentStorage } from '@edi-bridge/db'
import {
  bullmqRunQueue,
  Database,
  Delivery,
  type DeliveryService,
  Documents,
  processRun,
  type QueuedRun,
  queueReceivedRunsEvery,
  RunQueue,
  runQueueName,
} from '@edi-bridge/pipeline'

const unwiredDelivery: DeliveryService = () =>
  Effect.die(new Error('Delivery is not wired into the worker yet'))

export function startRunWorker({
  redisUrl,
  db,
  requeueInterval,
}: {
  redisUrl: string
  db: Connection['db']
  requeueInterval: Duration.Input
}) {
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
          Effect.provideService(Delivery, unwiredDelivery),
        ),
      ),
    { connection: redis },
  )

  const requeueing = Effect.runFork(
    queueReceivedRunsEvery(requeueInterval).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(RunQueue, queue.service),
    ),
  )

  return {
    worker,
    close: async () => {
      await Effect.runPromise(Fiber.interrupt(requeueing))
      await Promise.all([worker.close(), queue.close()])
      redis.disconnect()
    },
  }
}
