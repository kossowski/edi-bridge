import { afterAll, describe, expect, it } from 'vitest'

import { channelsEndpoint } from '@edi-bridge/contracts'
import { connect, localDatabaseUrl } from '@edi-bridge/db'

import { buildApp } from './app.js'

const connection = connect(localDatabaseUrl)

const app = buildApp({
  database: connection.db,
  probes: { postgres: () => Promise.resolve(), redis: () => Promise.resolve() },
})

afterAll(async () => {
  await app.close()
  await connection.close()
})

describe('GET /channels', () => {
  it('lists no Channels until Channels are stored', async () => {
    const response = await app.inject({ method: 'GET', url: channelsEndpoint.path })

    expect(response.statusCode).toBe(200)
    expect(channelsEndpoint.response.parse(response.json())).toEqual([])
  })
})
