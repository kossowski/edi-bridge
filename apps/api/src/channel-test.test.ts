import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  listening,
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
} from '@edi-bridge/channels/testing'
import {
  type ChannelInput,
  createChannelEndpoint,
  createdChannelSchema,
  testChannelEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { channels } from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let admin: Client

let sftp: TestSftpServer

let erp: TestErp

let silent: Server

let silentPort: number

const openSockets = new Set<Socket>()

beforeAll(async () => {
  ;[api, sftp, erp] = await Promise.all([startTestApi(), startTestSftpServer(), startTestErp()])
  ;({ admin } = api)

  silent = createTcpServer((socket) => {
    openSockets.add(socket)
  })
  silentPort = await listening(silent)
}, 180_000)

afterAll(async () => {
  for (const socket of openSockets) {
    socket.destroy()
  }

  silent.close()
  await Promise.all([api.stop(), sftp.stop(), erp.stop()])
})

beforeEach(async () => {
  erp.received.length = 0
  await api.connection.db.delete(channels)
})

const created = async (input: ChannelInput, target = admin) => {
  const response = await target.inject({
    method: 'POST',
    url: createChannelEndpoint.path,
    body: input,
  })

  expect(response.statusCode, response.body).toBe(201)

  return createdChannelSchema.parse(response.json()).channel
}

const tested = async (id: string, target = admin) => {
  const response = await target.inject({
    method: 'POST',
    url: toPath(testChannelEndpoint.path, { id }),
  })

  return { status: response.statusCode, body: response.json<unknown>() }
}

const outcomeOf = async (input: ChannelInput) => {
  const { status, body } = await tested((await created(input)).id)

  expect(status).toBe(200)

  return testChannelEndpoint.response.parse(body)
}

const sftpOutbox = () =>
  ({
    type: 'sftp',
    direction: 'outbound',
    name: 'Hansemarkt SFTP outbox',
    tradingPartnerId: null,
    host: sftp.host,
    port: sftp.port,
    username: sftp.username,
    remotePath: '/upload',
    authentication: 'password',
    credential: sftp.password,
  }) satisfies ChannelInput

const httpDelivery = (url = erp.url) =>
  ({
    type: 'http',
    direction: 'outbound',
    name: 'ERP HTTP delivery',
    tradingPartnerId: null,
    url,
    authorization: 'Bearer erp-api-key-0815',
  }) satisfies ChannelInput

describe('POST /channels/:id/test for an SFTP Channel', () => {
  it('logs in with the stored password and reaches the remote path', async () => {
    const before = Date.now()

    const result = await outcomeOf(sftpOutbox())

    expect(result.outcome).toBe('succeeded')
    expect(Date.parse(result.testedAt)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('logs in with the stored private key of an inbound Channel', async () => {
    expect(
      await outcomeOf({
        ...sftpOutbox(),
        direction: 'inbound',
        pollingIntervalMinutes: 1,
        authentication: 'privateKey',
        credential: sftp.privateKey,
      }),
    ).toMatchObject({ outcome: 'succeeded' })
  })

  it('reports a rejected login', async () => {
    expect(await outcomeOf({ ...sftpOutbox(), credential: 'wrong-password' })).toMatchObject({
      outcome: 'failed',
      reason: 'loginRejected',
    })
  })
})

describe('POST /channels/:id/test for an HTTP Channel', () => {
  it('reaches the destination with the stored authorization and sends no Document', async () => {
    expect(await outcomeOf(httpDelivery())).toMatchObject({ outcome: 'succeeded' })

    expect(erp.received).toHaveLength(1)
    expect(erp.received[0]).toMatchObject({
      method: 'HEAD',
      url: '/api/edi/documents',
      headers: { authorization: 'Bearer erp-api-key-0815' },
      body: '',
    })
  })

  it('reports a rejected authorization', async () => {
    expect(await outcomeOf(httpDelivery(`${erp.url}?status=401`))).toMatchObject({
      outcome: 'failed',
      reason: 'loginRejected',
    })
  })

  // Passes only with the 1.5 s reach timeout of the test settings; the 10 s default outlasts the test.
  it('reports a host that never answers as timed out', async () => {
    expect(await outcomeOf(httpDelivery(`http://127.0.0.1:${String(silentPort)}/`))).toMatchObject({
      outcome: 'failed',
      reason: 'timedOut',
    })
  })
})

describe('POST /channels/:id/test', () => {
  it('reports success for a webhook Channel, which has nothing to reach', async () => {
    expect(
      await outcomeOf({
        type: 'webhook',
        direction: 'inbound',
        name: 'ERP webhook',
        tradingPartnerId: null,
        rateLimitPerMinute: 60,
      }),
    ).toMatchObject({ outcome: 'succeeded' })
  })

  it('answers 404 for a Channel of another Workspace', async () => {
    const channel = await created(httpDelivery(), api.otherAdmin)

    expect((await tested(channel.id)).status).toBe(404)
    expect(erp.received).toEqual([])
  })

  it('is not available to a Viewer', async () => {
    const channel = await created(httpDelivery())

    expect((await tested(channel.id, api.viewer)).status).toBe(403)
    expect(erp.received).toEqual([])
  })
})
