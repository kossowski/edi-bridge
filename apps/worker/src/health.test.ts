import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createHealthServer } from './health.js'

import type { HealthServerOptions } from './health.js'

const up = () => Promise.resolve()

const down = () => Promise.reject(new Error('connection refused'))

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

async function request(
  options: HealthServerOptions,
  path = '/health',
  init?: RequestInit,
): Promise<Response> {
  server = createHealthServer(options).listen(0, '127.0.0.1')
  await once(server, 'listening')
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never null or a pipe path.
  const { port } = server.address() as AddressInfo

  return fetch(`http://127.0.0.1:${String(port)}${path}`, init)
}

const getHealth = (options: HealthServerOptions) => request(options)

describe('worker health check', () => {
  it('reports healthy when Redis is reachable', async () => {
    const response = await getHealth({ probes: { redis: up } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'healthy', checks: { redis: 'up' } })
  })

  it('reports unhealthy when Redis is unreachable', async () => {
    const response = await getHealth({ probes: { redis: down } })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unhealthy', checks: { redis: 'down' } })
  })

  it('reports Redis as down when its probe does not answer in time', async () => {
    const hangs = () => new Promise<never>(() => {})
    const response = await getHealth({ probes: { redis: hangs }, probeTimeoutMs: 20 })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unhealthy', checks: { redis: 'down' } })
  })

  it('answers 404 on any other path', async () => {
    const response = await request({ probes: { redis: up } }, '/other')

    expect(response.status).toBe(404)
  })

  it('answers 404 on any other method', async () => {
    const response = await request({ probes: { redis: up } }, '/health', { method: 'POST' })

    expect(response.status).toBe(404)
  })
})
