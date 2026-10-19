import { Effect } from 'effect'
import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { utils } from 'ssh2'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { channelReach, type HttpDestination, type SftpLogin } from './index'

const sftpImage =
  'atmoz/sftp:alpine@sha256:7e439fabeae536fa254340724c042e11999924d906417dbb5c73602ad518813f'

const sftpUser = { username: 'edi_bridge', password: 'edi-bridge-sftp-password' }

const keyPair = utils.generateKeyPairSync('ed25519')

const reach = channelReach({ timeoutMs: 1500 })

interface ReceivedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

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

const refusedPort = async () => {
  const refusing = createTcpServer()
  const port = await listening(refusing)
  await new Promise((resolve) => refusing.close(resolve))

  return port
}

beforeAll(async () => {
  sftp = await new GenericContainer(sftpImage)
    .withPlatform('linux/amd64')
    .withCommand([`${sftpUser.username}:${sftpUser.password}:::upload`])
    .withCopyContentToContainer([
      { content: `${keyPair.public}\n`, target: `/home/${sftpUser.username}/.ssh/keys/id.pub` },
    ])
    .withExposedPorts(22)
    .withWaitStrategy(Wait.forLogMessage(/Server listening on/))
    .start()

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
  await sftp.stop()
})

beforeEach(() => {
  received.length = 0
})

const outcome = (effect: Effect.Effect<void, { reason: string }>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.as({ outcome: 'succeeded' }),
      Effect.catch((error) => Effect.succeed({ outcome: 'failed', reason: error.reason })),
    ),
  )

const sftpOutbox = (): SftpLogin => ({
  host: sftp.getHost(),
  port: sftp.getMappedPort(22),
  username: sftpUser.username,
  credential: { password: sftpUser.password },
  remotePath: '/upload',
})

const httpDelivery = (url = erpUrl): HttpDestination => ({
  url,
  authorization: 'Bearer erp-api-key-0815',
})

describe('channelReach for an SFTP Channel', () => {
  it('logs in with a password and reaches the remote path', async () => {
    expect(await outcome(reach.sftp(sftpOutbox()))).toEqual({ outcome: 'succeeded' })
  })

  it('logs in with a private key', async () => {
    expect(
      await outcome(reach.sftp({ ...sftpOutbox(), credential: { privateKey: keyPair.private } })),
    ).toEqual({ outcome: 'succeeded' })
  })

  it('reports a rejected login', async () => {
    expect(
      await outcome(reach.sftp({ ...sftpOutbox(), credential: { password: 'wrong-password' } })),
    ).toEqual({ outcome: 'failed', reason: 'loginRejected' })
  })

  it('reports a private key that is not valid as a rejected login', async () => {
    expect(
      await outcome(
        reach.sftp({ ...sftpOutbox(), credential: { privateKey: 'not a private key' } }),
      ),
    ).toEqual({ outcome: 'failed', reason: 'loginRejected' })
  })

  it('reports a missing remote path', async () => {
    expect(await outcome(reach.sftp({ ...sftpOutbox(), remotePath: '/outbox' }))).toEqual({
      outcome: 'failed',
      reason: 'remotePathMissing',
    })
  })

  it('reports a remote path the user may not read', async () => {
    expect(await outcome(reach.sftp({ ...sftpOutbox(), remotePath: '/locked' }))).toEqual({
      outcome: 'failed',
      reason: 'permissionDenied',
    })
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const port = await refusedPort()

    expect(await outcome(reach.sftp({ ...sftpOutbox(), host: '127.0.0.1', port }))).toEqual({
      outcome: 'failed',
      reason: 'hostUnreachable',
    })
  })

  it('reports a host that never answers as timed out', async () => {
    expect(
      await outcome(reach.sftp({ ...sftpOutbox(), host: '127.0.0.1', port: silentPort })),
    ).toEqual({ outcome: 'failed', reason: 'timedOut' })
  })
})

describe('channelReach for an HTTP Channel', () => {
  it('reaches the destination with its authorization and sends no Document', async () => {
    expect(await outcome(reach.http(httpDelivery()))).toEqual({ outcome: 'succeeded' })

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      method: 'HEAD',
      url: '/api/edi/documents',
      headers: { authorization: 'Bearer erp-api-key-0815' },
      body: '',
    })
  })

  it('sends no authorization header when the destination has none', async () => {
    expect(await outcome(reach.http({ url: erpUrl, authorization: null }))).toEqual({
      outcome: 'succeeded',
    })

    expect(received[0]?.headers).not.toHaveProperty('authorization')
  })

  it('counts any answer from the destination but a rejection or a server error as reached', async () => {
    for (const status of [204, 301, 404, 405]) {
      expect(await outcome(reach.http(httpDelivery(`${erpUrl}?status=${status}`)))).toEqual({
        outcome: 'succeeded',
      })
    }
  })

  it('reports a rejected authorization', async () => {
    for (const status of [401, 403]) {
      expect(await outcome(reach.http(httpDelivery(`${erpUrl}?status=${status}`)))).toEqual({
        outcome: 'failed',
        reason: 'loginRejected',
      })
    }
  })

  it('reports a server error as an unexpected response', async () => {
    expect(await outcome(reach.http(httpDelivery(`${erpUrl}?status=503`)))).toEqual({
      outcome: 'failed',
      reason: 'unexpectedResponse',
    })
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const port = await refusedPort()

    expect(await outcome(reach.http(httpDelivery(`http://127.0.0.1:${port}/`)))).toEqual({
      outcome: 'failed',
      reason: 'hostUnreachable',
    })
  })

  it('reports a host that never answers as timed out', async () => {
    expect(await outcome(reach.http(httpDelivery(`http://127.0.0.1:${silentPort}/`)))).toEqual({
      outcome: 'failed',
      reason: 'timedOut',
    })
  })
})
