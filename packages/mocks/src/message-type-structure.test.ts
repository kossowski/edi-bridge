import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type MessageType,
  messageTypes,
  messageTypeStructureEndpoint,
  messageTypeStructures,
  toPath,
} from '@edi-bridge/contracts'

import { messageTypeStructureHandler } from './message-type-structure'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getStructure(messageType: MessageType) {
  server.use(messageTypeStructureHandler(apiUrl))

  const response = await fetch(
    `${apiUrl}${toPath(messageTypeStructureEndpoint.path, { messageType })}`,
  )

  return messageTypeStructureEndpoint.response.parse(await response.json())
}

describe('GET /message-types/:messageType/structure', () => {
  it.each(messageTypes)('serves the %s structure', async (messageType) => {
    expect(await getStructure(messageType)).toEqual(messageTypeStructures[messageType])
  })

  it('answers 404 for a Message Type without a structure', async () => {
    server.use(messageTypeStructureHandler(apiUrl))

    const response = await fetch(
      `${apiUrl}${toPath(messageTypeStructureEndpoint.path, { messageType: 'APERAK' })}`,
    )

    expect(response.status).toBe(404)
  })
})
