import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DownloadFailed,
  secretBox,
  secretKeyBytes,
  type SftpChannel,
  sftpChannelDownload,
  type SftpLogin,
  listSftp,
  readSftp,
  removeSftp,
} from './index'
import {
  mismatchingHostKeyFingerprint,
  startTestSftpServer,
  type TestSftpServer,
  testAddressPolicy,
  wrongPassphrase,
} from './testing'

const timeoutMs = 1500

let sftp: TestSftpServer

beforeAll(async () => {
  sftp = await startTestSftpServer()
}, 180_000)

afterAll(async () => {
  await sftp.stop()
})

const secrets = secretBox(Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'))

const channelId = '8a3f1c6e-2b94-4d7a-9e05-6c1d8b2f4a93'

const download = sftpChannelDownload({ secrets, timeoutMs, addressPolicy: testAddressPolicy })

const inboundChannel = (remotePath: string): SftpChannel => ({
  id: channelId,
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  remotePath,
  authentication: 'password',
  encryptedCredential: secrets.seal(sftp.password, `channels/${channelId}/encryptedCredential`),
  hostKeyFingerprint: null,
})

const inbox = async (name: string, files: Record<string, string | Buffer>) => {
  const path = `/upload/${name}`

  await sftp.exec(`install -d -m 777 ${sftp.home}${path}`)

  for (const [file, content] of Object.entries(files)) {
    await sftp.exec(
      `echo ${Buffer.from(content).toString('base64')} | base64 -d > ${sftp.home}${path}/${file}`,
    )
  }

  return inboundChannel(path)
}

const downloadOptions = { timeoutMs, addressPolicy: testAddressPolicy }

const protectedLogin = (remotePath: string, passphrase: string | undefined): SftpLogin => ({
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  remotePath,
  hostKeyFingerprint: null,
  credential:
    passphrase === undefined
      ? { privateKey: sftp.protectedKey.privateKey }
      : { privateKey: sftp.protectedKey.privateKey, passphrase },
})

const listedNames = async (channel: SftpChannel) =>
  (await Effect.runPromise(download.list(channel))).map(({ name }) => name).toSorted()

describe('sftpChannelDownload', () => {
  it('lists the files in the remote path of the channel', async () => {
    const channel = await inbox('listed', {
      'orders-1.edi': "UNB+UNOC:3'",
      'orders-2.edi': "UNB+UNOC:3'",
    })

    expect(await listedNames(channel)).toEqual(['orders-1.edi', 'orders-2.edi'])
  })

  it('lists the size and modification time of each file', async () => {
    const channel = await inbox('stat', {
      'orders-10.edi': "UNB+UNOC:3'",
      'orders-11.edi': "UNB+UNOC:3+4098765000002:14'",
    })

    await sftp.exec(`touch -d @1760889600 ${sftp.home}/upload/stat/orders-10.edi`)
    await sftp.exec(`touch -d @1760893200 ${sftp.home}/upload/stat/orders-11.edi`)

    expect(
      (await Effect.runPromise(download.list(channel))).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual([
      { name: 'orders-10.edi', size: 11, modifiedAt: new Date('2025-10-19T16:00:00Z') },
      { name: 'orders-11.edi', size: 28, modifiedAt: new Date('2025-10-19T17:00:00Z') },
    ])
  })

  it('leaves out directories and hidden files such as a partial upload', async () => {
    const channel = await inbox('mixed', {
      'orders-3.edi': "UNB+UNOC:3'",
      '.orders-4.edi.part': "UNB+UNOC:3'",
    })

    await sftp.exec(`install -d -m 777 ${sftp.home}/upload/mixed/archive`)

    expect(await listedNames(channel)).toEqual(['orders-3.edi'])
  })

  it('reads the content of a file', async () => {
    const channel = await inbox('read', {
      'orders-5.edi': "UNB+UNOC:3+4098765000002:14+4012345000009:14+261019:1627+5'",
    })

    expect((await Effect.runPromise(download.read(channel, 'orders-5.edi'))).toString()).toBe(
      "UNB+UNOC:3+4098765000002:14+4012345000009:14+261019:1627+5'",
    )
  })

  it('reads non-ASCII bytes unchanged', async () => {
    const content = Buffer.from([0x55, 0x4e, 0x42, 0x2b, 0xe4, 0xdf, 0x27])
    const channel = await inbox('latin1', { 'orders-12.edi': content })

    expect(await Effect.runPromise(download.read(channel, 'orders-12.edi'))).toEqual(content)
  })

  it('removes a file and keeps the others', async () => {
    const channel = await inbox('removed', {
      'orders-6.edi': "UNB+UNOC:3'",
      'orders-7.edi': "UNB+UNOC:3'",
    })

    await Effect.runPromise(download.remove(channel, 'orders-6.edi'))

    expect(await listedNames(channel)).toEqual(['orders-7.edi'])
  })

  it('reports a missing remote path', async () => {
    expect(await Effect.runPromise(Effect.flip(download.list(inboundChannel('/inbox'))))).toEqual(
      new DownloadFailed({ reason: 'remotePathMissing' }),
    )
  })

  it('reports a file that is no longer there', async () => {
    const channel = await inbox('gone', {})

    expect(await Effect.runPromise(Effect.flip(download.read(channel, 'orders-8.edi')))).toEqual(
      new DownloadFailed({ reason: 'remotePathMissing' }),
    )
  })

  it('lists the files of a server whose host key matches the stored fingerprint', async () => {
    const channel = await inbox('pinned', { 'orders-1.edi': 'UNB' })

    expect(await listedNames({ ...channel, hostKeyFingerprint: sftp.hostKeyFingerprint })).toEqual([
      'orders-1.edi',
    ])
  })

  it('refuses a server whose host key does not match the stored fingerprint', async () => {
    const channel = await inbox('impostor', { 'orders-1.edi': 'UNB' })
    const impostor = { ...channel, hostKeyFingerprint: mismatchingHostKeyFingerprint }

    for (const attempt of [
      download.list(impostor),
      download.read(impostor, 'orders-1.edi'),
      download.remove(impostor, 'orders-1.edi'),
    ]) {
      expect(await Effect.runPromise(Effect.flip(attempt))).toEqual(
        new DownloadFailed({ reason: 'hostKeyMismatch' }),
      )
    }

    expect(await listedNames(channel)).toEqual(['orders-1.edi'])
  })

  it('logs in with a protected private key and its passphrase', async () => {
    await inbox('protected', { 'orders-2.edi': 'UNB' })

    const files = await Effect.runPromise(
      listSftp(protectedLogin('/upload/protected', sftp.protectedKey.passphrase), downloadOptions),
    )

    expect(files.map(({ name }) => name)).toEqual(['orders-2.edi'])
  })

  it('reports a protected private key without its passphrase', async () => {
    const channel = await inbox('locked-key', { 'orders-3.edi': 'UNB' })

    const locked = protectedLogin('/upload/locked-key', undefined)

    for (const attempt of [
      listSftp(locked, downloadOptions),
      readSftp(locked, 'orders-3.edi', downloadOptions),
      removeSftp(locked, 'orders-3.edi', downloadOptions),
    ]) {
      expect(await Effect.runPromise(Effect.flip(attempt))).toEqual(
        new DownloadFailed({ reason: 'passphraseRejected' }),
      )
    }

    expect(await listedNames(channel)).toEqual(['orders-3.edi'])
  })

  it('reports a protected private key with a wrong passphrase', async () => {
    const channel = await inbox('wrong-passphrase', { 'orders-3.edi': 'UNB' })

    const rejected = protectedLogin('/upload/wrong-passphrase', wrongPassphrase)

    for (const attempt of [
      listSftp(rejected, downloadOptions),
      readSftp(rejected, 'orders-3.edi', downloadOptions),
      removeSftp(rejected, 'orders-3.edi', downloadOptions),
    ]) {
      expect(await Effect.runPromise(Effect.flip(attempt))).toEqual(
        new DownloadFailed({ reason: 'passphraseRejected' }),
      )
    }

    expect(await listedNames(channel)).toEqual(['orders-3.edi'])
  })

  it('refuses a credential sealed for another channel', async () => {
    const exit = await Effect.runPromiseExit(
      download.list({
        ...(await inbox('foreign', { 'orders-9.edi': "UNB+UNOC:3'" })),
        encryptedCredential: secrets.seal(
          sftp.password,
          'channels/0b7a4f2e-9c13-4d58-8e61-3f2a9d7c5b40/encryptedCredential',
        ),
      }),
    )

    expect(Exit.hasDies(exit)).toBe(true)
  })
})
