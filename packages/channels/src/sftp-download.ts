import { Data, Effect } from 'effect'
import { posix } from 'node:path'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

import { sftpReason, sftpSession, timingOut, unreachable, type SftpLogin } from './channel-reach'
import { type SftpChannel, sftpLogin } from './sftp-channel'

import type { SecretBox } from './secret'

export class DownloadFailed extends Data.TaggedError('DownloadFailed')<{
  readonly reason: ChannelTestFailureReason
}> {}

export interface SftpFile {
  readonly name: string
  readonly size: number
  readonly modifiedAt: Date
}

const downloading = <A>(
  login: SftpLogin,
  timeoutMs: number,
  use: Parameters<typeof sftpSession<A>>[2],
) =>
  timingOut(sftpSession(login, timeoutMs, use), timeoutMs).pipe(
    Effect.mapError(({ reason }) => new DownloadFailed({ reason })),
  )

export const listSftp = (login: SftpLogin, { timeoutMs }: { timeoutMs: number }) =>
  downloading<SftpFile[]>(login, timeoutMs, (sftp, done) => {
    sftp.readdir(login.remotePath, (error, entries) => {
      if (error) {
        done(Effect.fail(unreachable(sftpReason(error))))

        return
      }

      done(
        Effect.succeed(
          entries
            // A hidden name marks a file still being written, as uploadSftp does.
            .filter(({ filename, attrs }) => !filename.startsWith('.') && attrs.isFile())
            .map(({ filename, attrs }) => ({
              name: filename,
              size: attrs.size,
              modifiedAt: new Date(attrs.mtime * 1000),
            })),
        ),
      )
    })
  })

export const readSftp = (login: SftpLogin, name: string, { timeoutMs }: { timeoutMs: number }) =>
  downloading<Buffer>(login, timeoutMs, (sftp, done) => {
    sftp.readFile(posix.join(login.remotePath, name), (error, content) => {
      done(error ? Effect.fail(unreachable(sftpReason(error))) : Effect.succeed(content))
    })
  })

export const removeSftp = (login: SftpLogin, name: string, { timeoutMs }: { timeoutMs: number }) =>
  downloading<void>(login, timeoutMs, (sftp, done) => {
    sftp.unlink(posix.join(login.remotePath, name), (error) => {
      done(error ? Effect.fail(unreachable(sftpReason(error))) : Effect.void)
    })
  })

export const sftpChannelDownload = ({
  secrets,
  timeoutMs,
}: {
  secrets: SecretBox
  timeoutMs: number
}) => {
  const login = (channel: SftpChannel) => Effect.sync(() => sftpLogin(secrets, channel))

  return {
    list: (channel: SftpChannel) =>
      Effect.flatMap(login(channel), (channelLogin) => listSftp(channelLogin, { timeoutMs })),
    read: (channel: SftpChannel, name: string) =>
      Effect.flatMap(login(channel), (channelLogin) => readSftp(channelLogin, name, { timeoutMs })),
    remove: (channel: SftpChannel, name: string) =>
      Effect.flatMap(login(channel), (channelLogin) =>
        removeSftp(channelLogin, name, { timeoutMs }),
      ),
  }
}
