import { describe, expect, it } from 'vitest'

import { buildApp } from './app.js'

const up = () => Promise.resolve()

const down = () => Promise.reject(new Error('connection refused'))

describe('GET /health', () => {
  it('reports healthy when Postgres and Redis are reachable', async () => {
    const app = buildApp({ probes: { postgres: up, redis: up } })

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'healthy',
      checks: { postgres: 'up', redis: 'up' },
    })
  })

  it('reports unhealthy when Postgres is unreachable', async () => {
    const app = buildApp({ probes: { postgres: down, redis: up } })

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'unhealthy',
      checks: { postgres: 'down', redis: 'up' },
    })
  })

  it('reports unhealthy when Redis is unreachable', async () => {
    const app = buildApp({ probes: { postgres: up, redis: down } })

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'unhealthy',
      checks: { postgres: 'up', redis: 'down' },
    })
  })

  it('reports a dependency as down when its probe does not answer in time', async () => {
    const hangs = () => new Promise<never>(() => {})
    const app = buildApp({ probes: { postgres: hangs, redis: up }, probeTimeoutMs: 20 })

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      status: 'unhealthy',
      checks: { postgres: 'down', redis: 'up' },
    })
  })
})
