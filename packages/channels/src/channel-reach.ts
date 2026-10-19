import { Context, Data, Effect } from 'effect'
import { Client, type SFTPWrapper } from 'ssh2'
import { z } from 'zod'

import type { ChannelTestFailureReason } from '@edi-bridge/contracts'

export class ChannelUnreachable extends Data.TaggedError('ChannelUnreachable')<{
  readonly reason: ChannelTestFailureReason
}> {}

export type SftpCredential = { password: string } | { privateKey: string }

export interface SftpLogin {
  host: string
  port: number
  username: string
  credential: SftpCredential
  remotePath: string
}

export interface HttpDestination {
  url: string
  authorization: string | null
}

export class ChannelReach extends Context.Service<
  ChannelReach,
  {
    readonly sftp: (login: SftpLogin) => Effect.Effect<void, ChannelUnreachable>
    readonly http: (destination: HttpDestination) => Effect.Effect<void, ChannelUnreachable>
  }
>()('ChannelReach') {}

export const unreachable = (reason: ChannelTestFailureReason) => new ChannelUnreachable({ reason })

const unreachableHostCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
])

const timedOutCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])

const networkReason = (code: string | undefined): ChannelTestFailureReason | undefined => {
  if (code === undefined) {
    return undefined
  }

  if (timedOutCodes.has(code)) {
    return 'timedOut'
  }

  return unreachableHostCodes.has(code) ? 'hostUnreachable' : undefined
}

const sshLevelSchema = z.enum([
  'client-authentication',
  'client-timeout',
  'client-dns',
  'client-socket',
])

const sshReasons = {
  'client-authentication': 'loginRejected',
  'client-timeout': 'timedOut',
  'client-dns': 'hostUnreachable',
  'client-socket': 'hostUnreachable',
} as const satisfies Record<z.infer<typeof sshLevelSchema>, ChannelTestFailureReason>

const sshFailureSchema = z.object({
  level: sshLevelSchema.optional().catch(undefined),
  code: z.string().optional().catch(undefined),
})

const sshReason = (error: Error): ChannelTestFailureReason => {
  const { level, code } = sshFailureSchema.parse(error)

  return networkReason(code) ?? (level && sshReasons[level]) ?? 'unexpectedResponse'
}

const sftpStatusReasons = {
  2: 'remotePathMissing',
  3: 'permissionDenied',
} as const satisfies Record<number, ChannelTestFailureReason>

const sftpFailureSchema = z.object({
  code: z
    .union([z.literal(2), z.literal(3)])
    .optional()
    .catch(undefined),
})

export const sftpReason = (error: Error): ChannelTestFailureReason => {
  const { code } = sftpFailureSchema.parse(error)

  return code === undefined ? 'unexpectedResponse' : sftpStatusReasons[code]
}

// Opening the directory proves the user may read it without transferring a Document.
const statAndOpenDirectory = (
  sftp: SFTPWrapper,
  path: string,
  done: (outcome: Effect.Effect<void, ChannelUnreachable>) => void,
) => {
  sftp.stat(path, (statError, stats) => {
    if (statError) {
      done(Effect.fail(unreachable(sftpReason(statError))))

      return
    }

    if (!stats.isDirectory()) {
      done(Effect.fail(unreachable('remotePathMissing')))

      return
    }

    sftp.opendir(path, (openError, handle) => {
      if (openError) {
        done(Effect.fail(unreachable(sftpReason(openError))))

        return
      }

      sftp.close(handle, () => {
        done(Effect.void)
      })
    })
  })
}

// The host key is not pinned yet, so any key the server presents is accepted.
export const sftpSession = <A>(
  login: SftpLogin,
  timeoutMs: number,
  use: (sftp: SFTPWrapper, done: (outcome: Effect.Effect<A, ChannelUnreachable>) => void) => void,
) =>
  Effect.callback<A, ChannelUnreachable>((resume) => {
    const client = new Client()
    let settled = false

    const settle = (outcome: Effect.Effect<A, ChannelUnreachable>) => {
      if (settled) {
        return
      }

      settled = true
      client.end()
      resume(outcome)
    }

    client.on('error', (error) => {
      settle(Effect.fail(unreachable(sshReason(error))))
    })
    client.on('close', () => {
      settle(Effect.fail(unreachable('unexpectedResponse')))
    })
    client.on('ready', () => {
      client.sftp((error, sftp) => {
        if (error) {
          settle(Effect.fail(unreachable('unexpectedResponse')))

          return
        }

        use(sftp, settle)
      })
    })

    try {
      client.connect({
        host: login.host,
        port: login.port,
        username: login.username,
        readyTimeout: timeoutMs,
        ...login.credential,
      })
    } catch {
      settle(Effect.fail(unreachable('loginRejected')))
    }

    return Effect.sync(() => {
      settled = true
      client.end()
    })
  })

const reachSftp = (login: SftpLogin, timeoutMs: number) =>
  sftpSession(login, timeoutMs, (sftp, done) => {
    statAndOpenDirectory(sftp, login.remotePath, done)
  })

const httpStatusReason = (status: number): ChannelTestFailureReason | undefined => {
  if (status === 401 || status === 403) {
    return 'loginRejected'
  }

  return status >= 500 ? 'unexpectedResponse' : undefined
}

const fetchFailureSchema = z.object({ cause: z.object({ code: z.string() }) })

// HEAD sends no Document; an endpoint that only accepts POST still answers it.
const reachHttp = ({ url, authorization }: HttpDestination) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: authorization === null ? {} : { authorization },
        signal,
      }),
    catch: (error) =>
      unreachable(
        networkReason(fetchFailureSchema.safeParse(error).data?.cause.code) ?? 'unexpectedResponse',
      ),
  }).pipe(
    Effect.flatMap((response) => {
      const reason = httpStatusReason(response.status)

      return reason === undefined ? Effect.void : Effect.fail(unreachable(reason))
    }),
  )

export const timingOut = <A>(effect: Effect.Effect<A, ChannelUnreachable>, timeoutMs: number) =>
  Effect.timeoutOrElse(effect, {
    duration: timeoutMs,
    orElse: () => Effect.fail(unreachable('timedOut')),
  })

export const channelReach = ({ timeoutMs }: { timeoutMs: number }) =>
  ChannelReach.of({
    sftp: (login) => timingOut(reachSftp(login, timeoutMs), timeoutMs),
    http: (destination) => timingOut(reachHttp(destination), timeoutMs),
  })
