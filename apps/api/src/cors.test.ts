import { afterAll, describe, expect, it } from 'vitest'

import { createTradingPartnerEndpoint } from '@edi-bridge/contracts'
import { connect, localDatabaseUrl } from '@edi-bridge/db'

import { buildApp } from './app.js'
import { testAuth, testChannels, testRunQueue } from './testing.js'

const connection = connect(localDatabaseUrl)

const webOrigin = 'http://localhost:3000'

const app = buildApp({
  auth: testAuth,
  channels: testChannels,
  database: connection.db,
  probes: { postgres: () => Promise.resolve(), redis: () => Promise.resolve() },
  runQueue: testRunQueue().service,
  webOrigin,
})

afterAll(async () => {
  await app.close()
  await connection.close()
})

const preflight = (origin: string) =>
  app.inject({
    method: 'OPTIONS',
    url: createTradingPartnerEndpoint.path,
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  })

describe('CORS', () => {
  it('lets the web origin send credentialed JSON requests', async () => {
    const response = await preflight(webOrigin)

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(webOrigin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    expect(response.headers['access-control-allow-methods']).toContain('PUT')
    expect(response.headers['access-control-allow-headers']).toContain('content-type')
  })

  it('allows the web origin on a request without preflight', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: webOrigin },
    })

    expect(response.headers['access-control-allow-origin']).toBe(webOrigin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('does not allow another origin', async () => {
    const response = await preflight('https://elsewhere.example')

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
