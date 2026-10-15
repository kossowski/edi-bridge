import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { channelsEndpoint } from '@edi-bridge/contracts'

import { startTestApi, type TestApi } from './testing.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

describe('GET /channels', () => {
  it('lists no Channels until Channels are stored', async () => {
    const response = await api.admin.inject({ method: 'GET', url: channelsEndpoint.path })

    expect(response.statusCode).toBe(200)
    expect(channelsEndpoint.response.parse(response.json())).toEqual([])
  })
})
