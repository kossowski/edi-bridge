import Fastify from 'fastify'

import type { FastifyInstance } from 'fastify'

/** Resolves when the dependency is reachable, rejects otherwise. */
export type Probe = () => Promise<unknown>

export interface AppDependencies {
  logger?: boolean
  probes: { postgres: Probe; redis: Probe }
  /** How long a probe may take before its dependency counts as down. */
  probeTimeoutMs?: number
}

type CheckStatus = 'down' | 'up'

const check = (probe: Probe, timeoutMs: number): Promise<CheckStatus> =>
  Promise.race([
    probe(),
    new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('probe timed out'))
      }, timeoutMs).unref()
    }),
  ]).then(
    () => 'up',
    () => 'down',
  )

export function buildApp({
  logger = false,
  probes,
  probeTimeoutMs = 2000,
}: AppDependencies): FastifyInstance {
  const app = Fastify({ logger })

  app.get('/health', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([
      check(probes.postgres, probeTimeoutMs),
      check(probes.redis, probeTimeoutMs),
    ])
    const healthy = postgres === 'up' && redis === 'up'

    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? 'healthy' : 'unhealthy', checks: { postgres, redis } })
  })

  return app
}
