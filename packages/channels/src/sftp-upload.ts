import { Data, Effect } from 'effect'
import { posix } from 'node:path'

import type { ChannelTestFailureReason, SftpAuthentication } from '@edi-bridge/contracts'

import { sftpReason, sftpSession, timingOut, unreachable, type SftpLogin } from './channel-reach'
import { type SecretBox, secretContext } from './secret'

export class DeliveryFailed extends Data.TaggedError('DeliveryFailed')<{
  readonly reason: ChannelTestFailureReason
}> {}

export interface OutboundFile {
  name: string
  content: Buffer
}

export const uploadSftp = (
  login: SftpLogin,
  file: OutboundFile,
  { timeoutMs }: { timeoutMs: number },
) => {
  const target = posix.join(login.remotePath, file.name)
  const partial = posix.join(login.remotePath, `.${file.name}.part`)

  return timingOut(
    sftpSession(login, timeoutMs, (sftp, done) => {
      const discardPartial = (error: Error) => {
        sftp.unlink(partial, () => {
          done(unreachable(sftpReason(error)))
        })
      }

      sftp.writeFile(partial, file.content, (writeError) => {
        if (writeError) {
          discardPartial(writeError)

          return
        }

        // Plain SFTP rename refuses an existing target, so a file of the same name is never replaced.
        sftp.rename(partial, target, (renameError) => {
          if (renameError) {
            discardPartial(renameError)

            return
          }

          done()
        })
      })
    }),
    timeoutMs,
  ).pipe(Effect.mapError(({ reason }) => new DeliveryFailed({ reason })))
}

export interface OutboundSftpChannel {
  id: string
  host: string | null
  port: number | null
  username: string | null
  remotePath: string | null
  authentication: SftpAuthentication | null
  encryptedCredential: string | null
}

// The database checks that an SFTP Channel has all its settings, so a missing one is a defect.
const loginOf = (secrets: SecretBox, channel: OutboundSftpChannel): SftpLogin => {
  const { id, host, port, username, remotePath, authentication, encryptedCredential } = channel

  if (
    host === null ||
    port === null ||
    username === null ||
    remotePath === null ||
    authentication === null ||
    encryptedCredential === null
  ) {
    throw new Error(`Channel ${id} has no SFTP settings`)
  }

  const credential = secrets.open(encryptedCredential, secretContext(id, 'encryptedCredential'))

  return {
    host,
    port,
    username,
    remotePath,
    credential:
      authentication === 'password' ? { password: credential } : { privateKey: credential },
  }
}

export const sftpChannelDelivery =
  ({ secrets, timeoutMs }: { secrets: SecretBox; timeoutMs: number }) =>
  (channel: OutboundSftpChannel, file: OutboundFile) =>
    Effect.flatMap(
      Effect.sync(() => loginOf(secrets, channel)),
      (login) => uploadSftp(login, file, { timeoutMs }),
    )
