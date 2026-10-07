import { Redis } from 'ioredis'
import { once } from 'node:events'

import { config } from './config.js'
import { createHealthServer } from './health.js'

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

const healthServer = createHealthServer({ probes: { redis: () => redis.ping() } })

function shutdown(): void {
  healthServer.close()
  redis.disconnect()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, shutdown)
}

healthServer.listen(config.healthPort, '0.0.0.0')
await once(healthServer, 'listening')
console.info(`worker health check listening on port ${String(config.healthPort)}`)
