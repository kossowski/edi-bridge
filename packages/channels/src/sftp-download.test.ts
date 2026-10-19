import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DownloadFailed,
  secretBox,
  secretKeyBytes,
  type SftpChannel,
  sftpChannelDownload,
} from './index'
import { startTestSftpServer, type TestSftpServer } from './testing'

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

const download = sftpChannelDownload({ secrets, timeoutMs })

const inboundChannel = (remotePath: string): SftpChannel => ({
  id: channelId,
  host: sftp.host,
  port: sftp.port,
  username: sftp.username,
  remotePath,
  authentication: 'password',
  encryptedCredential: secrets.seal(sftp.password, `channels/${channelId}/encryptedCredential`),
})

const inbox = async (name: string, files: Record<string, string>) => {
  const path = `/upload/${name}`

  await sftp.exec(`install -d -m 777 ${sftp.home}${path}`)

  for (const [file, content] of Object.entries(files)) {
    await sftp.exec(
      `echo ${Buffer.from(content).toString('base64')} | base64 -d > ${sftp.home}${path}/${file}`,
    )
  }

  return inboundChannel(path)
}

describe('sftpChannelDownload', () => {
  it('lists the files in the remote path of the channel', async () => {
    const channel = await inbox('listed', {
      'orders-1.edi': "UNB+UNOC:3'",
      'orders-2.edi': "UNB+UNOC:3'",
    })

    expect((await Effect.runPromise(download.list(channel))).toSorted()).toEqual([
      'orders-1.edi',
      'orders-2.edi',
    ])
  })

  it('leaves out directories and hidden files such as a partial upload', async () => {
    const channel = await inbox('mixed', {
      'orders-3.edi': "UNB+UNOC:3'",
      '.orders-4.edi.part': "UNB+UNOC:3'",
    })

    await sftp.exec(`install -d -m 777 ${sftp.home}/upload/mixed/archive`)

    expect(await Effect.runPromise(download.list(channel))).toEqual(['orders-3.edi'])
  })

  it('reads the content of a file', async () => {
    const channel = await inbox('read', {
      'orders-5.edi': "UNB+UNOC:3+4098765000002:14+4012345000009:14+261019:1627+5'",
    })

    expect((await Effect.runPromise(download.read(channel, 'orders-5.edi'))).toString()).toBe(
      "UNB+UNOC:3+4098765000002:14+4012345000009:14+261019:1627+5'",
    )
  })

  it('removes a file and keeps the others', async () => {
    const channel = await inbox('removed', {
      'orders-6.edi': "UNB+UNOC:3'",
      'orders-7.edi': "UNB+UNOC:3'",
    })

    await Effect.runPromise(download.remove(channel, 'orders-6.edi'))

    expect(await Effect.runPromise(download.list(channel))).toEqual(['orders-7.edi'])
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
