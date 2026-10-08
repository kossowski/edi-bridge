import { createServer } from 'node:http'

import type { Server } from 'node:http'

export type Probe = () => Promise<void>

export interface HealthServerOptions {
  probes: { redis: Probe }
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

export function createHealthServer({ probes, probeTimeoutMs = 2000 }: HealthServerOptions): Server {
  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')

    if (request.method !== 'GET' || pathname !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))

      return
    }

    void check(probes.redis, probeTimeoutMs).then((redis) => {
      const healthy = redis === 'up'

      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: healthy ? 'healthy' : 'unhealthy', checks: { redis } }))
    })
  })
}
