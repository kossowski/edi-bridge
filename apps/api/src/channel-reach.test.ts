import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { utils } from 'ssh2'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  type ChannelInput,
  createChannelEndpoint,
  createdChannelSchema,
  testChannelEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { channels } from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

const sftpImage =
  'atmoz/sftp:alpine@sha256:7e439fabeae536fa254340724c042e11999924d906417dbb5c73602ad518813f'

const sftpUser = { username: 'edi_bridge', password: 'edi-bridge-sftp-password' }

const keyPair = utils.generateKeyPairSync('ed25519')

interface ReceivedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

let api: TestApi

let admin: Client

let sftp: StartedTestContainer

let erp: Server

let erpUrl: string

let silent: Server

let silentPort: number

const received: ReceivedRequest[] = []

const openSockets = new Set<Socket>()

const listening = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return z.object({ port: z.number() }).parse(server.address()).port
}

beforeAll(async () => {
  const started = await Promise.all([
    startTestApi(),
    new GenericContainer(sftpImage)
      .withPlatform('linux/amd64')
      .withCommand([`${sftpUser.username}:${sftpUser.password}:::upload`])
      .withCopyContentToContainer([
        { content: `${keyPair.public}\n`, target: `/home/${sftpUser.username}/.ssh/keys/id.pub` },
      ])
      .withExposedPorts(22)
      .withWaitStrategy(Wait.forLogMessage(/Server listening on/))
      .start(),
  ])

  ;[api, sftp] = started
  ;({ admin } = api)

  await sftp.exec(['sh', '-c', `install -d -m 700 /home/${sftpUser.username}/locked`])

  erp = createHttpServer((request, response) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      received.push({ method: request.method, url: request.url, headers: request.headers, body })

      const status = Number(new URL(request.url ?? '/', 'http://erp').searchParams.get('status'))

      response.writeHead(status || 200).end()
    })
  })
  erpUrl = `http://127.0.0.1:${await listening(erp)}/api/edi/documents`

  silent = createTcpServer((socket) => {
    openSockets.add(socket)
  })
  silentPort = await listening(silent)
}, 180_000)

afterAll(async () => {
  for (const socket of openSockets) {
    socket.destroy()
  }

  erp.close()
  silent.close()
  await Promise.all([api.stop(), sftp.stop()])
})

beforeEach(async () => {
  received.length = 0
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
    host: sftp.getHost(),
    port: sftp.getMappedPort(22),
    username: sftpUser.username,
    remotePath: '/upload',
    authentication: 'password',
    credential: sftpUser.password,
  }) satisfies ChannelInput

const httpDelivery = (url = erpUrl) =>
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
        credential: keyPair.private,
      }),
    ).toMatchObject({ outcome: 'succeeded' })
  })

  it('reports a rejected login', async () => {
    expect(await outcomeOf({ ...sftpOutbox(), credential: 'wrong-password' })).toMatchObject({
      outcome: 'failed',
      reason: 'loginRejected',
    })
  })

  it('reports a private key that is not valid as a rejected login', async () => {
    expect(
      await outcomeOf({
        ...sftpOutbox(),
        authentication: 'privateKey',
        credential: 'not a private key',
      }),
    ).toMatchObject({ outcome: 'failed', reason: 'loginRejected' })
  })

  it('reports a missing remote path', async () => {
    expect(await outcomeOf({ ...sftpOutbox(), remotePath: '/outbox' })).toMatchObject({
      outcome: 'failed',
      reason: 'remotePathMissing',
    })
  })

  it('reports a remote path the user may not read', async () => {
    expect(await outcomeOf({ ...sftpOutbox(), remotePath: '/locked' })).toMatchObject({
      outcome: 'failed',
      reason: 'permissionDenied',
    })
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const refusing = createTcpServer()
    const port = await listening(refusing)
    await new Promise((resolve) => refusing.close(resolve))

    expect(await outcomeOf({ ...sftpOutbox(), host: '127.0.0.1', port })).toMatchObject({
      outcome: 'failed',
      reason: 'hostUnreachable',
    })
  })

  it('reports a host that never answers as timed out', async () => {
    expect(await outcomeOf({ ...sftpOutbox(), host: '127.0.0.1', port: silentPort })).toMatchObject(
      { outcome: 'failed', reason: 'timedOut' },
    )
  })
})

describe('POST /channels/:id/test for an HTTP Channel', () => {
  it('reaches the destination with the stored authorization and sends no Document', async () => {
    expect(await outcomeOf(httpDelivery())).toMatchObject({ outcome: 'succeeded' })

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      method: 'HEAD',
      url: '/api/edi/documents',
      headers: { authorization: 'Bearer erp-api-key-0815' },
      body: '',
    })
  })

  it('counts any answer from the destination but a rejection or a server error as reached', async () => {
    for (const status of [204, 301, 404, 405]) {
      expect(await outcomeOf(httpDelivery(`${erpUrl}?status=${status}`))).toMatchObject({
        outcome: 'succeeded',
      })
    }
  })

  it('reports a rejected authorization', async () => {
    for (const status of [401, 403]) {
      expect(await outcomeOf(httpDelivery(`${erpUrl}?status=${status}`))).toMatchObject({
        outcome: 'failed',
        reason: 'loginRejected',
      })
    }
  })

  it('reports a server error as an unexpected response', async () => {
    expect(await outcomeOf(httpDelivery(`${erpUrl}?status=503`))).toMatchObject({
      outcome: 'failed',
      reason: 'unexpectedResponse',
    })
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const refusing = createTcpServer()
    const port = await listening(refusing)
    await new Promise((resolve) => refusing.close(resolve))

    expect(await outcomeOf(httpDelivery(`http://127.0.0.1:${port}/`))).toMatchObject({
      outcome: 'failed',
      reason: 'hostUnreachable',
    })
  })

  it('reports a host that never answers as timed out', async () => {
    expect(await outcomeOf(httpDelivery(`http://127.0.0.1:${silentPort}/`))).toMatchObject({
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
    expect(received).toEqual([])
  })

  it('is not available to a Viewer', async () => {
    const channel = await created(httpDelivery())

    expect((await tested(channel.id, api.viewer)).status).toBe(403)
    expect(received).toEqual([])
  })
})
