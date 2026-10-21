import { Redis } from 'ioredis'
import { once } from 'node:events'

import { addressPolicy, secretBox } from '@edi-bridge/channels'
import { connect } from '@edi-bridge/db'

import { config } from './config.js'
import { createHealthServer } from './health.js'
import { startRunWorker } from './run-worker.js'
import { startSentry, stopSentry } from './sentry.js'

const monitoring = config.sentry && startSentry(config.sentry)

// Without the offline queue, commands fail fast while Redis is unreachable instead of waiting
// for a reconnect, so the health check reports the outage right away.
const redis = new Redis(config.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })

redis.on('ready', () => {
  console.info('worker connected to redis')
})

redis.on('error', (error: NodeJS.ErrnoException) => {
  // Connection failures arrive as an AggregateError with an empty message, so prefer the code.
  console.warn(`redis connection error: ${error.code ?? error.message}`)
})

const connection = connect(config.databaseUrl)

const runWorker = startRunWorker({
  redisUrl: config.redisUrl,
  db: connection.db,
  secrets: secretBox(config.channelSecretKey),
  addressPolicy: addressPolicy(config.channelAllowedHosts),
  requeueInterval: config.requeueInterval,
  stuckAfter: config.stuckAfter,
  monitoring,
})

runWorker.worker.on('error', (error) => {
  console.warn(`run worker error: ${error.message}`)
})

// The processing of a Run reports its defect itself, so a failed job is not reported again.
runWorker.worker.on('failed', (queued, error) => {
  console.error(`run ${queued?.data.runId ?? 'unknown'} failed: ${error.message}`)
})

const healthServer = createHealthServer({
  probes: {
    redis: async () => {
      await redis.ping()
    },
  },
})

async function shutdown(): Promise<void> {
  healthServer.close()

  // The worker closes first, so a Run in flight still reaches the database.
  for (const close of [() => runWorker.close(), () => connection.close()]) {
    try {
      await close()
    } catch (error) {
      console.error(`worker shutdown failed: ${String(error)}`)
    }
  }

  redis.disconnect()

  if (monitoring) {
    await stopSentry()
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown()
  })
}

healthServer.listen(config.healthPort, '0.0.0.0')

await once(healthServer, 'listening')

console.info(`worker health check listening on port ${String(config.healthPort)}`)
