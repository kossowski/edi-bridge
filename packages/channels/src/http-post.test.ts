import { Effect } from 'effect'
import { createServer, type Server, type Socket } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { DeliveryFailed, type HttpDestination, type OutboundDocument, postHttp } from './index'
import { listening, startTestErp, type TestErp } from './testing'

const timeoutMs = 1500

let erp: TestErp

let silent: Server

let silentPort: number

const openSockets = new Set<Socket>()

beforeAll(async () => {
  erp = await startTestErp()

  silent = createServer((socket) => {
    openSockets.add(socket)
  })
  silentPort = await listening(silent)
})

afterAll(async () => {
  for (const socket of openSockets) {
    socket.destroy()
  }

  silent.close()
  await erp.stop()
})

const refusedPort = async () => {
  const refusing = createServer()
  const port = await listening(refusing)
  await new Promise((resolve) => refusing.close(resolve))

  return port
}

beforeEach(() => {
  erp.received.length = 0
})

const destination = (url = erp.url): HttpDestination => ({
  url,
  authorization: 'Bearer erp-api-key-0815',
})

const order = (): OutboundDocument => ({
  name: 'orders-42-1.json',
  content: Buffer.from('{"orderNumber":"PO-4711","lines":[{"gtin":"4012345000016"}]}'),
  mediaType: 'application/json',
})

const failure = (effect: Effect.Effect<void, DeliveryFailed>) =>
  Effect.runPromise(Effect.flip(effect))

describe('postHttp', () => {
  it('posts the document with its media type and the authorization', async () => {
    await Effect.runPromise(postHttp(destination(), order(), { timeoutMs }))

    expect(erp.received).toHaveLength(1)
    expect(erp.received[0]).toMatchObject({
      method: 'POST',
      url: '/api/edi/documents',
      headers: {
        authorization: 'Bearer erp-api-key-0815',
        'content-type': 'application/json',
      },
      body: '{"orderNumber":"PO-4711","lines":[{"gtin":"4012345000016"}]}',
    })
  })

  it('sends no authorization header when the destination has none', async () => {
    await Effect.runPromise(postHttp({ url: erp.url, authorization: null }, order(), { timeoutMs }))

    expect(erp.received[0]?.headers).not.toHaveProperty('authorization')
  })

  it('reports a rejected authorization', async () => {
    for (const status of [401, 403]) {
      expect(
        await failure(postHttp(destination(`${erp.url}?status=${status}`), order(), { timeoutMs })),
      ).toEqual(new DeliveryFailed({ reason: 'loginRejected' }))
    }
  })

  it('reports any other answer but a 2xx as an unexpected response', async () => {
    for (const status of [301, 404, 422, 503]) {
      expect(
        await failure(postHttp(destination(`${erp.url}?status=${status}`), order(), { timeoutMs })),
      ).toEqual(new DeliveryFailed({ reason: 'unexpectedResponse' }))
    }
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const port = await refusedPort()

    expect(
      await failure(postHttp(destination(`http://127.0.0.1:${port}/`), order(), { timeoutMs })),
    ).toEqual(new DeliveryFailed({ reason: 'hostUnreachable' }))
  })

  it('reports a host that never answers as timed out', async () => {
    expect(
      await failure(
        postHttp(destination(`http://127.0.0.1:${silentPort}/`), order(), { timeoutMs }),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'timedOut' }))
  })
})
