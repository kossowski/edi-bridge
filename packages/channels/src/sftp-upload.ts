import { Data, Effect } from 'effect'
import { posix } from 'node:path'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

import { sftpReason, sftpSession, timingOut, unreachable, type SftpLogin } from './channel-reach'
import { type SftpChannel, sftpLogin } from './sftp-channel'

import type { SecretBox } from './secret'

export class DeliveryFailed extends Data.TaggedError('DeliveryFailed')<{
  readonly reason: ChannelTestFailureReason
}> {}

export interface OutboundDocument {
  name: string
  content: Buffer
}

export const uploadSftp = (
  login: SftpLogin,
  document: OutboundDocument,
  { timeoutMs }: { timeoutMs: number },
) => {
  const target = posix.join(login.remotePath, document.name)
  const partial = posix.join(login.remotePath, `.${document.name}.part`)

  return timingOut(
    sftpSession<void>(login, timeoutMs, (sftp, done) => {
      const discardPartial = (error: Error) => {
        sftp.unlink(partial, () => {
          done(Effect.fail(unreachable(sftpReason(error))))
        })
      }

      sftp.writeFile(partial, document.content, (writeError) => {
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

          done(Effect.void)
        })
      })
    }),
    timeoutMs,
  ).pipe(Effect.mapError(({ reason }) => new DeliveryFailed({ reason })))
}

export const sftpChannelDelivery =
  ({ secrets, timeoutMs }: { secrets: SecretBox; timeoutMs: number }) =>
  (channel: SftpChannel, document: OutboundDocument) =>
    Effect.flatMap(
      Effect.sync(() => sftpLogin(secrets, channel)),
      (login) => uploadSftp(login, document, { timeoutMs }),
    )
