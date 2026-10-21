import { Effect, Exit } from 'effect'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { TestedHostKey } from '@edi-bridge/contracts'

import { channelReach, ChannelUnreachable, type HttpDestination, type SftpLogin } from './index'
import {
  listening,
  mismatchingHostKeyFingerprint,
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
  testAddressPolicy,
} from './testing'

const reach = channelReach({ timeoutMs: 1500, addressPolicy: testAddressPolicy })

let sftp: TestSftpServer

let erp: TestErp

let silent: Server

let silentPort: number

const openSockets = new Set<Socket>()

const refusedPort = async () => {
  const refusing = createTcpServer()
  const port = await listening(refusing)
  await new Promise((resolve) => refusing.close(resolve))

  return port
}

beforeAll(async () => {
  ;[sftp, erp] = await Promise.all([startTestSftpServer(), startTestErp()])

  await sftp.exec(`install -d -m 700 ${sftp.home}/locked`)

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
  await Promise.all([erp.stop(), sftp.stop()])
})

beforeEach(() => {
  erp.received.length = 0
})

const outcome = (effect: Effect.Effect<void, { reason: string }>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.as({ outcome: 'succeeded' }),
      Effect.catch((error) => Effect.succeed({ outcome: 'failed', reason: error.reason })),
    ),
  )

const hostKeyOutcome = (effect: Effect.Effect<TestedHostKey, ChannelUnreachable>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.map((hostKey) => ({ outcome: 'succeeded', hostKey })),
      Effect.catch(({ reason, hostKey }) => Effect.succeed({ outcome: 'failed', reason, hostKey })),
    ),
  )

const sftpOutbox = (): SftpLogin => ({
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  credential: { password: sftp.password },
  remotePath: '/upload',
  hostKeyFingerprint: null,
})

const httpDelivery = (url = erp.url): HttpDestination => ({
  url,
  authorization: 'Bearer erp-api-key-0815',
})

describe('channelReach for an SFTP Channel', () => {
  it('logs in with a password and reaches the remote path', async () => {
    expect(await outcome(reach.sftp(sftpOutbox()))).toEqual({ outcome: 'succeeded' })
  })

  it('logs in with a private key', async () => {
    expect(
      await outcome(reach.sftp({ ...sftpOutbox(), credential: { privateKey: sftp.privateKey } })),
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

  it('logs in with a protected private key and its passphrase', async () => {
    expect(await outcome(reach.sftp({ ...sftpOutbox(), credential: sftp.protectedKey }))).toEqual({
      outcome: 'succeeded',
    })
  })

  it('reports a protected private key without a passphrase as a rejected passphrase', async () => {
    expect(
      await outcome(
        reach.sftp({
          ...sftpOutbox(),
          credential: { privateKey: sftp.protectedKey.privateKey },
        }),
      ),
    ).toEqual({ outcome: 'failed', reason: 'passphraseRejected' })
  })

  it('reports a wrong passphrase without naming it', async () => {
    const passphrase = 'wrong-key-passphrase'

    const exit = await Effect.runPromiseExit(
      reach.sftp({
        ...sftpOutbox(),
        credential: { privateKey: sftp.protectedKey.privateKey, passphrase },
      }),
    )

    expect(exit).toEqual(Exit.fail(new ChannelUnreachable({ reason: 'passphraseRejected' })))
    expect(JSON.stringify(exit)).not.toContain(passphrase)
  })

  it('reports a wrong passphrase before it checks the host key', async () => {
    expect(
      await hostKeyOutcome(
        reach.sftp({
          ...sftpOutbox(),
          credential: { ...sftp.protectedKey, passphrase: 'wrong-key-passphrase' },
          hostKeyFingerprint: mismatchingHostKeyFingerprint,
        }),
      ),
    ).toEqual({ outcome: 'failed', reason: 'passphraseRejected', hostKey: undefined })
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

describe('channelReach for the host key of an SFTP Channel', () => {
  it('reports the fingerprint of the server as unchecked when the Channel stores none', async () => {
    expect(await hostKeyOutcome(reach.sftp(sftpOutbox()))).toEqual({
      outcome: 'succeeded',
      hostKey: { fingerprint: sftp.hostKeyFingerprint, state: 'unchecked' },
    })
  })

  it('reports a fingerprint that matches the stored one', async () => {
    expect(
      await hostKeyOutcome(
        reach.sftp({ ...sftpOutbox(), hostKeyFingerprint: sftp.hostKeyFingerprint }),
      ),
    ).toEqual({
      outcome: 'succeeded',
      hostKey: { fingerprint: sftp.hostKeyFingerprint, state: 'matches' },
    })
  })

  it('refuses a server whose fingerprint does not match the stored one', async () => {
    expect(
      await hostKeyOutcome(
        reach.sftp({ ...sftpOutbox(), hostKeyFingerprint: mismatchingHostKeyFingerprint }),
      ),
    ).toEqual({
      outcome: 'failed',
      reason: 'hostKeyMismatch',
      hostKey: { fingerprint: sftp.hostKeyFingerprint, state: 'mismatch' },
    })
  })

  it('refuses a mismatching server before it logs in', async () => {
    expect(
      await hostKeyOutcome(
        reach.sftp({
          ...sftpOutbox(),
          credential: { password: 'wrong-password' },
          hostKeyFingerprint: mismatchingHostKeyFingerprint,
        }),
      ),
    ).toMatchObject({ outcome: 'failed', reason: 'hostKeyMismatch' })
  })

  it('reports the fingerprint along with a failure after the host key check', async () => {
    expect(
      await hostKeyOutcome(
        reach.sftp({
          ...sftpOutbox(),
          credential: { password: 'wrong-password' },
          hostKeyFingerprint: sftp.hostKeyFingerprint,
        }),
      ),
    ).toEqual({
      outcome: 'failed',
      reason: 'loginRejected',
      hostKey: { fingerprint: sftp.hostKeyFingerprint, state: 'matches' },
    })
  })

  it('reports no fingerprint when the server is not reached', async () => {
    const port = await refusedPort()

    expect(await hostKeyOutcome(reach.sftp({ ...sftpOutbox(), host: '127.0.0.1', port }))).toEqual({
      outcome: 'failed',
      reason: 'hostUnreachable',
      hostKey: undefined,
    })
  })
})

describe('channelReach for an HTTP Channel', () => {
  it('reaches the destination with its authorization and sends no Document', async () => {
    expect(await outcome(reach.http(httpDelivery()))).toEqual({ outcome: 'succeeded' })

    expect(erp.received).toHaveLength(1)
    expect(erp.received[0]).toMatchObject({
      method: 'HEAD',
      url: '/api/edi/documents',
      headers: { authorization: 'Bearer erp-api-key-0815' },
      body: '',
    })
  })

  it('sends no authorization header when the destination has none', async () => {
    expect(await outcome(reach.http({ url: erp.url, authorization: null }))).toEqual({
      outcome: 'succeeded',
    })

    expect(erp.received[0]?.headers).not.toHaveProperty('authorization')
  })

  it('counts any answer from the destination but a rejection or a server error as reached', async () => {
    for (const status of [204, 301, 404, 405]) {
      expect(await outcome(reach.http(httpDelivery(`${erp.url}?status=${status}`)))).toEqual({
        outcome: 'succeeded',
      })
    }
  })

  it('reports a rejected authorization', async () => {
    for (const status of [401, 403]) {
      expect(await outcome(reach.http(httpDelivery(`${erp.url}?status=${status}`)))).toEqual({
        outcome: 'failed',
        reason: 'loginRejected',
      })
    }
  })

  it('reports a server error as an unexpected response', async () => {
    expect(await outcome(reach.http(httpDelivery(`${erp.url}?status=503`)))).toEqual({
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
