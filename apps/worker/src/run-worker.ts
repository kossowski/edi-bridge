import { Worker } from 'bullmq'
import { type Duration, Effect, Fiber } from 'effect'
import { Redis } from 'ioredis'

import { type AddressPolicy, type SecretBox, sftpChannelDownload } from '@edi-bridge/channels'
import { type Connection, postgresDocumentStorage } from '@edi-bridge/db'
import {
  bullmqRunQueue,
  channelDelivery,
  Database,
  Delivery,
  Documents,
  Download,
  LiveEvents,
  pollInboundChannels,
  processRun,
  type QueuedRun,
  redisLiveEvents,
  RunQueue,
  runQueueName,
  sweepRunsEvery,
} from '@edi-bridge/pipeline'

import { type Monitoring, withMonitoring } from './sentry.js'

const channelTimeoutMs = 10_000

export function startRunWorker({
  redisUrl,
  db,
  secrets,
  addressPolicy,
  requeueInterval,
  stuckAfter,
  pollingMinute,
  monitoring,
}: {
  redisUrl: string
  db: Connection['db']
  secrets: SecretBox
  addressPolicy: AddressPolicy
  requeueInterval: Duration.Input
  stuckAfter: Duration.Input
  pollingMinute?: Duration.Input
  monitoring?: Monitoring | undefined
}) {
  // BullMQ blocks on its worker connection, so commands must wait for a reconnect, not fail.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const documents = postgresDocumentStorage(db)
  const queue = bullmqRunQueue(redisUrl)
  const liveEvents = redisLiveEvents(redisUrl)
  const connecting = { secrets, timeoutMs: channelTimeoutMs, addressPolicy }
  const delivery = channelDelivery(connecting)
  const download = sftpChannelDownload(connecting)

  const worker = new Worker<QueuedRun>(
    runQueueName,
    ({ data }) =>
      Effect.runPromise(
        processRun(data).pipe(
          Effect.provideService(Database, db),
          Effect.provideService(Documents, documents),
          Effect.provideService(Delivery, delivery),
          Effect.provideService(LiveEvents, liveEvents.service),
          withMonitoring(monitoring, data),
        ),
      ),
    { connection: redis },
  )

  const sweeping = Effect.runFork(
    sweepRunsEvery({ interval: requeueInterval, stuckAfter }).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(RunQueue, queue.service),
      Effect.provideService(Delivery, delivery),
      Effect.provideService(LiveEvents, liveEvents.service),
      withMonitoring(monitoring),
    ),
  )

  const polling = Effect.runFork(
    pollInboundChannels(pollingMinute).pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, documents),
      Effect.provideService(RunQueue, queue.service),
      Effect.provideService(Download, download),
      Effect.provideService(LiveEvents, liveEvents.service),
      withMonitoring(monitoring),
    ),
  )

  return {
    worker,
    close: async () => {
      // A poll in flight stores and removes its current file before it stops.
      await Effect.runPromise(Fiber.interruptAll([polling, sweeping]))
      await Promise.all([worker.close(), queue.close()])
      liveEvents.close()
      redis.disconnect()
    },
  }
}
