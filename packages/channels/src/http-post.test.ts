import { Effect, Exit } from 'effect'
import { createServer as createHttpServer, type ServerResponse } from 'node:http'
import { createServer, type Server, type Socket } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DeliveryFailed,
  type HttpChannel,
  httpChannelDelivery,
  type HttpDestination,
  type OutboundDocument,
  postHttp,
  secretBox,
  secretKeyBytes,
  addressPolicy,
} from './index'
import { listening, startTestErp, type TestErp, testAllowedHosts } from './testing'

const allowed = addressPolicy(testAllowedHosts)

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
    await Effect.runPromise(postHttp(destination(), order(), { timeoutMs, addressPolicy: allowed }))

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
    await Effect.runPromise(
      postHttp({ url: erp.url, authorization: null }, order(), {
        timeoutMs,
        addressPolicy: allowed,
      }),
    )

    expect(erp.received[0]?.headers).not.toHaveProperty('authorization')
  })

  it('reports a rejected authorization with the answered status', async () => {
    for (const status of [401, 403]) {
      expect(
        await failure(
          postHttp(destination(`${erp.url}?status=${status}`), order(), {
            timeoutMs,
            addressPolicy: allowed,
          }),
        ),
      ).toEqual(
        new DeliveryFailed({ reason: 'loginRejected', details: { kind: 'httpResponse', status } }),
      )
    }
  })

  it('reports any other answer but a 2xx as an unexpected response with its status', async () => {
    for (const status of [301, 404, 422, 503]) {
      expect(
        await failure(
          postHttp(destination(`${erp.url}?status=${status}`), order(), {
            timeoutMs,
            addressPolicy: allowed,
          }),
        ),
      ).toEqual(
        new DeliveryFailed({
          reason: 'unexpectedResponse',
          details: { kind: 'httpResponse', status },
        }),
      )
    }
  })

  it('releases the connection of an unread answer body', async () => {
    const answers: ServerResponse[] = []

    const streaming = createHttpServer((request, response) => {
      const status = Number(new URL(request.url ?? '/', 'http://erp').searchParams.get('status'))

      answers.push(response)
      response.writeHead(status).write('an answer body the delivery never reads')
    })

    const port = await listening(streaming)

    try {
      await Effect.runPromise(
        postHttp(destination(`http://127.0.0.1:${port}/?status=200`), order(), {
          timeoutMs,
          addressPolicy: allowed,
        }),
      )
      await failure(
        postHttp(destination(`http://127.0.0.1:${port}/?status=503`), order(), {
          timeoutMs,
          addressPolicy: allowed,
        }),
      )

      await vi.waitFor(() => {
        expect(answers.map((answer) => answer.closed)).toEqual([true, true])
      })
    } finally {
      streaming.closeAllConnections()
      streaming.close()
    }
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const port = await refusedPort()

    expect(
      await failure(
        postHttp(destination(`http://127.0.0.1:${port}/`), order(), {
          timeoutMs,
          addressPolicy: allowed,
        }),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'hostUnreachable' }))
  })

  it('reports a host that never answers as timed out', async () => {
    expect(
      await failure(
        postHttp(destination(`http://127.0.0.1:${silentPort}/`), order(), {
          timeoutMs,
          addressPolicy: allowed,
        }),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'timedOut' }))
  })
})

const secrets = secretBox(Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'))

const channelId = '9a4c2e71-3b8d-4f05-b6e2-7d1f0c8a5e39'

const deliver = httpChannelDelivery({ secrets, timeoutMs, addressPolicy: allowed })

const erpChannel = (): HttpChannel => ({
  id: channelId,
  url: erp.url,
  encryptedAuthorization: secrets.seal(
    'Bearer erp-api-key-0815',
    `channels/${channelId}/encryptedAuthorization`,
  ),
})

describe('httpChannelDelivery', () => {
  it('opens the sealed authorization of the channel and posts the document', async () => {
    await Effect.runPromise(deliver(erpChannel(), order()))

    expect(erp.received).toHaveLength(1)
    expect(erp.received[0]).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer erp-api-key-0815' },
      body: '{"orderNumber":"PO-4711","lines":[{"gtin":"4012345000016"}]}',
    })
  })

  it('posts without authorization when the channel has none', async () => {
    await Effect.runPromise(deliver({ ...erpChannel(), encryptedAuthorization: null }, order()))

    expect(erp.received[0]?.headers).not.toHaveProperty('authorization')
  })

  it('refuses an authorization sealed for another channel', async () => {
    const exit = await Effect.runPromiseExit(
      deliver(
        {
          ...erpChannel(),
          encryptedAuthorization: secrets.seal(
            'Bearer erp-api-key-0815',
            'channels/0b7a4f2e-9c13-4d58-8e61-3f2a9d7c5b40/encryptedAuthorization',
          ),
        },
        order(),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)
    expect(erp.received).toHaveLength(0)
  })
})
