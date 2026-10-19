import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http'
import { utils } from 'ssh2'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { Server } from 'node:net'

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

const received: ReceivedRequest[] = []

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
}, 180_000)

afterAll(async () => {
  erp.close()
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
