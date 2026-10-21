import { Effect, Exit } from 'effect'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DeliveryFailed,
  type OutboundDocument,
  type SftpChannel,
  secretBox,
  secretKeyBytes,
  sftpChannelDelivery,
  type SftpLogin,
  uploadSftp,
} from './index'
import {
  listening,
  mismatchingHostKeyFingerprint,
  startTestSftpServer,
  type TestSftpServer,
  testAddressPolicy,
} from './testing'

const timeoutMs = 1500

const options = { timeoutMs, addressPolicy: testAddressPolicy }

let sftp: TestSftpServer

beforeAll(async () => {
  sftp = await startTestSftpServer()

  await sftp.exec(`install -d -m 555 ${sftp.home}/locked`)
}, 180_000)

afterAll(async () => {
  await sftp.stop()
})

const outbox = (): SftpLogin => ({
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  credential: { password: sftp.password },
  remotePath: '/upload',
  hostKeyFingerprint: null,
})

const interchange = (name: string): OutboundDocument => ({
  name,
  content: Buffer.from("UNB+UNOC:3+4012345000009:14+4098765000002:14+261019:1627+42'"),
})

const failure = (effect: Effect.Effect<void, DeliveryFailed>) =>
  Effect.runPromise(Effect.flip(effect))

const refusedPort = async () => {
  const refusing = createServer()
  const port = await listening(refusing)
  await new Promise((resolve) => refusing.close(resolve))

  return port
}

const remoteListing = async (path: string) =>
  (await sftp.exec(`ls -A ${sftp.home}${path}`)).output.split('\n').filter(Boolean)

const remoteFile = async (path: string) => (await sftp.exec(`cat ${sftp.home}${path}`)).output

describe('uploadSftp', () => {
  it('puts the file with its content into the remote path', async () => {
    await Effect.runPromise(uploadSftp(outbox(), interchange('orders-42.edi'), options))

    expect(await remoteFile('/upload/orders-42.edi')).toBe(
      "UNB+UNOC:3+4012345000009:14+4098765000002:14+261019:1627+42'",
    )
    expect(await remoteListing('/upload')).not.toContain('.orders-42.edi.part')
  })

  it('reports a missing remote path', async () => {
    expect(
      await failure(
        uploadSftp({ ...outbox(), remotePath: '/outbox' }, interchange('orders-43.edi'), options),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'remotePathMissing' }))
  })

  it('keeps a file of the same name and leaves no partial file behind', async () => {
    await sftp.exec(
      `install -d -m 777 ${sftp.home}/upload/taken && echo earlier > ${sftp.home}/upload/taken/orders-44.edi`,
    )

    expect(
      await failure(
        uploadSftp(
          { ...outbox(), remotePath: '/upload/taken' },
          interchange('orders-44.edi'),
          options,
        ),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'unexpectedResponse' }))

    expect(await remoteListing('/upload/taken')).toEqual(['orders-44.edi'])
    expect(await remoteFile('/upload/taken/orders-44.edi')).toBe('earlier\n')
  })

  it('counts a file of the same name as the earlier attempt of a Retry that landed and keeps it', async () => {
    await sftp.exec(
      `install -d -m 777 ${sftp.home}/upload/landed && echo earlier > ${sftp.home}/upload/landed/orders-48.edi`,
    )

    await Effect.runPromise(
      uploadSftp(
        { ...outbox(), remotePath: '/upload/landed' },
        { ...interchange('orders-48.edi'), isRetry: true },
        options,
      ),
    )

    expect(await remoteListing('/upload/landed')).toEqual(['orders-48.edi'])
    expect(await remoteFile('/upload/landed/orders-48.edi')).toBe('earlier\n')
  })

  it('replaces the partial file that the timed-out attempt of a Retry left behind', async () => {
    await sftp.exec(
      `install -d -m 777 ${sftp.home}/upload/resumed && echo UNB > ${sftp.home}/upload/resumed/.orders-47.edi.part && chown ${sftp.username} ${sftp.home}/upload/resumed/.orders-47.edi.part`,
    )

    await Effect.runPromise(
      uploadSftp(
        { ...outbox(), remotePath: '/upload/resumed' },
        { ...interchange('orders-47.edi'), isRetry: true },
        options,
      ),
    )

    expect(await remoteListing('/upload/resumed')).toEqual(['orders-47.edi'])
    expect(await remoteFile('/upload/resumed/orders-47.edi')).toBe(
      "UNB+UNOC:3+4012345000009:14+4098765000002:14+261019:1627+42'",
    )
  })

  it('reports a remote path the user may not write', async () => {
    expect(
      await failure(
        uploadSftp({ ...outbox(), remotePath: '/locked' }, interchange('orders-45.edi'), options),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'permissionDenied' }))
  })

  it('uploads to a server whose host key matches the stored fingerprint', async () => {
    await Effect.runPromise(
      uploadSftp(
        { ...outbox(), hostKeyFingerprint: sftp.hostKeyFingerprint },
        interchange('orders-49.edi'),
        options,
      ),
    )

    expect(await remoteListing('/upload')).toContain('orders-49.edi')
  })

  it('refuses a server whose host key does not match and uploads nothing', async () => {
    expect(
      await failure(
        uploadSftp(
          { ...outbox(), hostKeyFingerprint: mismatchingHostKeyFingerprint },
          interchange('orders-50.edi'),
          options,
        ),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'hostKeyMismatch' }))

    expect(await remoteListing('/upload')).not.toContain('orders-50.edi')
  })

  it('reports a host that refuses the connection as unreachable', async () => {
    const port = await refusedPort()

    expect(
      await failure(
        uploadSftp({ ...outbox(), host: '127.0.0.1', port }, interchange('orders-46.edi'), options),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'hostUnreachable' }))
  })
})

const secrets = secretBox(Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'))

const channelId = '5d1e8c3a-7f42-4b9e-a0d6-2c9b1f8e4a17'

const deliver = sftpChannelDelivery({ secrets, ...options })

const outboundChannel = (): SftpChannel => ({
  id: channelId,
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  remotePath: '/upload',
  authentication: 'password',
  encryptedCredential: secrets.seal(sftp.password, `channels/${channelId}/encryptedCredential`),
  hostKeyFingerprint: null,
})

describe('sftpChannelDelivery', () => {
  it('opens the sealed password of the channel and uploads the document', async () => {
    await Effect.runPromise(deliver(outboundChannel(), interchange('desadv-7.edi')))

    expect(await remoteFile('/upload/desadv-7.edi')).toBe(
      "UNB+UNOC:3+4012345000009:14+4098765000002:14+261019:1627+42'",
    )
  })

  it('opens the sealed private key of the channel', async () => {
    await Effect.runPromise(
      deliver(
        {
          ...outboundChannel(),
          authentication: 'privateKey',
          encryptedCredential: secrets.seal(
            sftp.privateKey,
            `channels/${channelId}/encryptedCredential`,
          ),
        },
        interchange('desadv-8.edi'),
      ),
    )

    expect(await remoteListing('/upload')).toContain('desadv-8.edi')
  })

  it('checks the host key against the fingerprint the channel stores', async () => {
    expect(
      await failure(
        deliver(
          { ...outboundChannel(), hostKeyFingerprint: mismatchingHostKeyFingerprint },
          interchange('desadv-10.edi'),
        ),
      ),
    ).toEqual(new DeliveryFailed({ reason: 'hostKeyMismatch' }))
  })

  it('refuses a credential sealed for another channel', async () => {
    const exit = await Effect.runPromiseExit(
      deliver(
        {
          ...outboundChannel(),
          encryptedCredential: secrets.seal(
            sftp.password,
            'channels/0b7a4f2e-9c13-4d58-8e61-3f2a9d7c5b40/encryptedCredential',
          ),
        },
        interchange('desadv-9.edi'),
      ),
    )

    expect(Exit.hasDies(exit)).toBe(true)
    expect(await remoteListing('/upload')).not.toContain('desadv-9.edi')
  })
})
