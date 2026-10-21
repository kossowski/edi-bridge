import { Context, Data, Effect } from 'effect'
import { createHash } from 'node:crypto'
import { isIP, type LookupFunction } from 'node:net'
import { Client, type SFTPWrapper } from 'ssh2'
import { Agent, fetch, type RequestInit } from 'undici'
import { z } from 'zod'

import type {
  ChannelTestFailureReason,
  HostKeyFingerprint,
  HostKeyState,
  TestedHostKey,
} from '@edi-bridge/contracts'

import { type AddressPolicy, blockedAddressOf } from './address-guard'

export class ChannelUnreachable extends Data.TaggedError('ChannelUnreachable')<{
  readonly reason: ChannelTestFailureReason
  readonly hostKey?: TestedHostKey
  readonly blockedAddress?: string
}> {}

export type SftpCredential = { password: string } | { privateKey: string }

export interface SftpLogin {
  host: string
  port: number
  username: string
  credential: SftpCredential
  remotePath: string
  hostKeyFingerprint: HostKeyFingerprint | null
}

export interface HttpDestination {
  url: string
  authorization: string | null
}

export class ChannelReach extends Context.Service<
  ChannelReach,
  {
    readonly sftp: (login: SftpLogin) => Effect.Effect<TestedHostKey, ChannelUnreachable>
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

const lookupFailureReasonSchema = z
  .object({ code: z.string() })
  .transform(({ code }) => networkReason(code) ?? 'hostUnreachable')
  .catch('hostUnreachable')

const resolvedAddresses = (host: string, { resolve }: AddressPolicy) =>
  Effect.tryPromise({
    try: () => resolve(host),
    catch: (error) => unreachable(lookupFailureReasonSchema.parse(error)),
  })

// Connecting to the checked address, not the host name, keeps a second lookup from rebinding it.
const connectAddress = (
  host: string,
  addressPolicy: AddressPolicy | undefined,
): Effect.Effect<string, ChannelUnreachable> =>
  addressPolicy === undefined
    ? Effect.succeed(host)
    : Effect.flatMap(resolvedAddresses(host, addressPolicy), (addresses) => {
        const blockedAddress = blockedAddressOf(addressPolicy, host, addresses)
        const [address] = addresses

        if (blockedAddress !== undefined) {
          return Effect.fail(new ChannelUnreachable({ reason: 'addressBlocked', blockedAddress }))
        }

        return address === undefined
          ? Effect.fail(unreachable('hostUnreachable'))
          : Effect.succeed(address)
      })

export interface ConnectOptions {
  timeoutMs: number
  addressPolicy?: AddressPolicy | undefined
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

// OpenSSH prints the same form, so an Admin can compare it with `ssh-keygen -l`.
const fingerprintOf = (hostKey: Buffer) =>
  `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`

const hostKeyState = (
  fingerprint: HostKeyFingerprint,
  stored: HostKeyFingerprint | null,
): HostKeyState => {
  if (stored === null) {
    return 'unchecked'
  }

  return fingerprint === stored ? 'matches' : 'mismatch'
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

// Unchecked without a fingerprint, so Channels set up before host key checks keep working.
export const sftpSession = <A>(
  login: SftpLogin,
  { timeoutMs, addressPolicy }: ConnectOptions,
  use: (
    sftp: SFTPWrapper,
    done: (outcome: Effect.Effect<A, ChannelUnreachable>) => void,
    hostKey: TestedHostKey,
  ) => void,
) =>
  Effect.flatMap(connectAddress(login.host, addressPolicy), (host) =>
    sshSession(host, login, timeoutMs, use),
  )

const sshSession = <A>(
  host: string,
  login: SftpLogin,
  timeoutMs: number,
  use: Parameters<typeof sftpSession<A>>[2],
) =>
  Effect.callback<A, ChannelUnreachable>((resume) => {
    const client = new Client()
    let settled = false
    let hostKey: TestedHostKey | undefined

    const settle = (outcome: Effect.Effect<A, ChannelUnreachable>) => {
      if (settled) {
        return
      }

      settled = true
      client.end()
      resume(
        Effect.mapError(outcome, (error) =>
          hostKey === undefined ? error : new ChannelUnreachable({ reason: error.reason, hostKey }),
        ),
      )
    }

    const fail = (reason: ChannelTestFailureReason) => {
      settle(Effect.fail(unreachable(hostKey?.state === 'mismatch' ? 'hostKeyMismatch' : reason)))
    }

    client.on('error', (error) => {
      fail(sshReason(error))
    })
    client.on('close', () => {
      fail('unexpectedResponse')
    })
    client.on('ready', () => {
      client.sftp((error, sftp) => {
        if (error) {
          fail('unexpectedResponse')

          return
        }

        if (hostKey === undefined) {
          settle(Effect.die(new Error('ssh2 opened a session without checking the host key')))

          return
        }

        use(sftp, settle, hostKey)
      })
    })

    try {
      client.connect({
        host,
        port: login.port,
        username: login.username,
        readyTimeout: timeoutMs,
        hostVerifier: (key: Buffer) => {
          const fingerprint = fingerprintOf(key)
          hostKey = { fingerprint, state: hostKeyState(fingerprint, login.hostKeyFingerprint) }

          return hostKey.state !== 'mismatch'
        },
        ...login.credential,
      })
    } catch {
      fail('loginRejected')
    }

    return Effect.sync(() => {
      settled = true
      client.end()
    })
  })

const reachSftp = (login: SftpLogin, options: ConnectOptions) =>
  sftpSession<TestedHostKey>(login, options, (sftp, done, hostKey) => {
    statAndOpenDirectory(sftp, login.remotePath, (outcome) => {
      done(Effect.as(outcome, hostKey))
    })
  })

export const rejectedLoginReason = (status: number): ChannelTestFailureReason | undefined =>
  status === 401 || status === 403 ? 'loginRejected' : undefined

const httpStatusReason = (status: number): ChannelTestFailureReason | undefined =>
  rejectedLoginReason(status) ?? (status >= 500 ? 'unexpectedResponse' : undefined)

export const fetchFailureReasonSchema = z
  .object({ cause: z.object({ code: z.string() }) })
  .transform(({ cause }) => networkReason(cause.code) ?? 'unexpectedResponse')
  .catch('unexpectedResponse')

const pinnedLookup =
  (address: string): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family: isIP(address) }])
    } else {
      callback(null, address, isIP(address))
    }
  }

const requesting = (url: string, init: RequestInit, dispatcher?: Agent) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal,
        ...(dispatcher && { dispatcher }),
      })

      // An unread body holds its keep-alive connection until garbage collection.
      await response.body?.cancel()

      return response
    },
    catch: (error) => unreachable(fetchFailureReasonSchema.parse(error)),
  })

// The URL keeps its host name, so TLS still checks the certificate against it.
export const httpRequest = (
  url: string,
  init: RequestInit,
  addressPolicy: AddressPolicy | undefined,
) => {
  const host = URL.parse(url)?.hostname.replace(/^\[(.*)\]$/, '$1')

  if (addressPolicy === undefined || host === undefined) {
    return requesting(url, init)
  }

  return Effect.flatMap(connectAddress(host, addressPolicy), (address) =>
    Effect.acquireUseRelease(
      Effect.sync(() => new Agent({ connect: { lookup: pinnedLookup(address) } })),
      (agent) => requesting(url, init, agent),
      (agent) => Effect.promise(() => agent.destroy()),
    ),
  )
}

// HEAD sends no Document; an endpoint that only accepts POST still answers it.
const reachHttp = ({ url, authorization }: HttpDestination, addressPolicy?: AddressPolicy) =>
  httpRequest(
    url,
    { method: 'HEAD', headers: authorization === null ? {} : { authorization } },
    addressPolicy,
  ).pipe(
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

// Without an address policy a Channel may reach any address.
export const channelReach = (options: ConnectOptions) =>
  ChannelReach.of({
    sftp: (login) => timingOut(reachSftp(login, options), options.timeoutMs),
    http: (destination) =>
      timingOut(reachHttp(destination, options.addressPolicy), options.timeoutMs),
  })
