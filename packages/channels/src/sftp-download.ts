import { Data, Effect } from 'effect'
import { posix } from 'node:path'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

import {
  type ChannelUnreachable,
  type ConnectOptions,
  sftpReason,
  sftpSession,
  type SftpUse,
  timingOut,
  unreachable,
  type SftpLogin,
} from './channel-reach'
import { type SftpChannel, sftpLogin } from './sftp-channel'

import type { SecretBox } from './secret'

export class DownloadFailed extends Data.TaggedError('DownloadFailed')<{
  readonly reason: ChannelTestFailureReason
  readonly blockedAddress?: string
}> {}

const downloadFailed = ({ reason, blockedAddress }: ChannelUnreachable) =>
  blockedAddress === undefined
    ? new DownloadFailed({ reason })
    : new DownloadFailed({ reason, blockedAddress })

export interface SftpFile {
  readonly name: string
  readonly size: number
  readonly modifiedAt: Date
}

const downloading = <A>(login: SftpLogin, options: ConnectOptions, use: SftpUse<A>) =>
  timingOut(sftpSession(login, options, use), options.timeoutMs).pipe(
    Effect.mapError(downloadFailed),
  )

export const listSftp = (login: SftpLogin, options: ConnectOptions) =>
  downloading<SftpFile[]>(login, options, (sftp, done) => {
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

export const readSftp = (login: SftpLogin, name: string, options: ConnectOptions) =>
  downloading<Buffer>(login, options, (sftp, done) => {
    sftp.readFile(posix.join(login.remotePath, name), (error, content) => {
      done(error ? Effect.fail(unreachable(sftpReason(error))) : Effect.succeed(content))
    })
  })

export const removeSftp = (login: SftpLogin, name: string, options: ConnectOptions) =>
  downloading<void>(login, options, (sftp, done) => {
    sftp.unlink(posix.join(login.remotePath, name), (error) => {
      done(error ? Effect.fail(unreachable(sftpReason(error))) : Effect.void)
    })
  })

export const sftpChannelDownload = ({
  secrets,
  ...options
}: ConnectOptions & { secrets: SecretBox }) => {
  const login = (channel: SftpChannel) => Effect.sync(() => sftpLogin(secrets, channel))

  return {
    list: (channel: SftpChannel) =>
      Effect.flatMap(login(channel), (channelLogin) => listSftp(channelLogin, options)),
    read: (channel: SftpChannel, name: string) =>
      Effect.flatMap(login(channel), (channelLogin) => readSftp(channelLogin, name, options)),
    remove: (channel: SftpChannel, name: string) =>
      Effect.flatMap(login(channel), (channelLogin) => removeSftp(channelLogin, name, options)),
  }
}
