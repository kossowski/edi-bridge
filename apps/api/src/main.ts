import { Redis } from 'ioredis'
import postgres from 'postgres'

import { buildApp } from './app.js'
import { config } from './config.js'

const sql = postgres(config.databaseUrl, { connect_timeout: 2, max: 5 })

// Without the offline queue, commands fail fast while Redis is unreachable instead of waiting
// for a reconnect, so the health route reports the outage right away.
const redis = new Redis(config.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })

const app = buildApp({
  logger: true,
  probes: {
    postgres: async () => {
      await sql`select 1`
    },
    redis: async () => {
      await redis.ping()
    },
  },
})

redis.on('error', (error: Error) => {
  app.log.warn({ err: error }, 'redis connection error')
})

async function shutdown(): Promise<void> {
  await app.close()
  await sql.end({ timeout: 5 })
  redis.disconnect()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown()
  })
}

await app.listen({ host: '0.0.0.0', port: config.port })
