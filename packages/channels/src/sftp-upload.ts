import { Effect } from 'effect'
import { posix } from 'node:path'

import { sftpReason, sftpSession, timingOut, unreachable, type SftpLogin } from './channel-reach'
import { DeliveryFailed, type OutboundDocument } from './delivery'
import { type SftpChannel, sftpLogin } from './sftp-channel'

import type { SecretBox } from './secret'

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

      // Writing the partial file replaces one that an attempt which timed out left behind.
      const upload = () => {
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
      }

      if (!document.isRetry) {
        upload()

        return
      }

      // For a Retry, a file of the final name is its earlier attempt that landed.
      sftp.stat(target, (missing) => {
        if (missing) {
          upload()

          return
        }

        done(Effect.void)
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
