import { createServer } from 'node:http'

import type { Server } from 'node:http'

/** Resolves when the dependency is reachable, rejects otherwise. */
export type Probe = () => Promise<unknown>

export interface HealthServerOptions {
  probes: { redis: Probe }
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

/** A tiny HTTP server exposing the worker's health, for local checks and container health checks. */
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
