import { Data, Effect } from 'effect'
import { posix } from 'node:path'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

import { sftpReason, sftpSession, timingOut, unreachable, type SftpLogin } from './channel-reach'

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
