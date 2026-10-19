import { Worker } from 'bullmq'
import { type Duration, Effect, Fiber } from 'effect'
import { Redis } from 'ioredis'

import { type SecretBox, sftpChannelDownload } from '@edi-bridge/channels'
import { type Connection, postgresDocumentStorage } from '@edi-bridge/db'
import {
  bullmqRunQueue,
  channelDelivery,
  Database,
  Delivery,
  Documents,
  Download,
  pollInboundChannels,
  processRun,
  type QueuedRun,
  queueReceivedRunsEvery,
  RunQueue,
  runQueueName,
} from '@edi-bridge/pipeline'

const channelTimeoutMs = 10_000

export function startRunWorker({
  redisUrl,
  db,
  secrets,
  requeueInterval,
  pollingMinute,
}: {
  redisUrl: string
  db: Connection['db']
  secrets: SecretBox
  requeueInterval: Duration.Input
  pollingMinute?: Duration.Input
}) {
  // BullMQ blocks on its worker connection, so commands must wait for a reconnect, not fail.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const documents = postgresDocumentStorage(db)
  const queue = bullmqRunQueue(redisUrl)
  const delivery = channelDelivery({ secrets, timeoutMs: channelTimeoutMs })
  const download = sftpChannelDownload({ secrets, timeoutMs: channelTimeoutMs })

  const worker = new Worker<QueuedRun>(
    runQueueName,
    ({ data }) =>
      Effect.runPromise(
        processRun(data).pipe(
          Effect.provideService(Database, db),
          Effect.provideService(Documents, documents),
          Effect.provideService(Delivery, delivery),
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

  const polling = Effect.runFork(
    pollInboundChannels(pollingMinute).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, documents),
      Effect.provideService(RunQueue, queue.service),
      Effect.provideService(Download, download),
    ),
  )

  return {
    worker,
    close: async () => {
      // A poll in flight stores and removes its current file before it stops.
      await Effect.runPromise(Fiber.interruptAll([polling, requeueing]))
      await Promise.all([worker.close(), queue.close()])
      redis.disconnect()
    },
  }
}
