import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  messageTypes,
  messageTypeStructureEndpoint,
  messageTypeStructures,
  toPath,
} from '@edi-bridge/contracts'

import { startTestApi, type TestApi } from './testing.js'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const structurePath = (messageType: string) =>
  toPath(messageTypeStructureEndpoint.path, { messageType })

describe('GET /message-types/:messageType/structure', () => {
  it.each(messageTypes)('serves the EANCOM structure of %s', async (messageType) => {
    const response = await api.viewer.inject({ method: 'GET', url: structurePath(messageType) })

    expect(response.statusCode).toBe(200)
    expect(messageTypeStructureEndpoint.response.parse(response.json())).toEqual(
      messageTypeStructures[messageType],
    )
  })

  it.each(['ORDRES', 'orders', 'IFTMIN'])('answers 404 for the unknown %s', async (messageType) => {
    const response = await api.admin.inject({ method: 'GET', url: structurePath(messageType) })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 401 without a session', async () => {
    const response = await api.app.inject({ method: 'GET', url: structurePath('ORDERS') })

    expect(response.statusCode).toBe(401)
  })
})
