import { Context, Data, Effect } from 'effect'
import { createHash } from 'node:crypto'
import { connect, isIP, type LookupFunction, type Socket } from 'node:net'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { Agent, buildConnector, fetch, type RequestInit } from 'undici'
import { z } from 'zod'

import type {
  ChannelTestFailureReason,
  HostKeyFingerprint,
  HostKeyState,
  TestedHostKey,
} from '@edi-bridge/contracts'

import { type AddressPolicy, blockedAddressOf } from './address-guard'
import { unlockedKey } from './private-key'

export class ChannelUnreachable extends Data.TaggedError('ChannelUnreachable')<{
  readonly reason: ChannelTestFailureReason
  readonly hostKey?: TestedHostKey
  readonly blockedAddress?: string
}> {}

export type SftpCredential = { password: string } | { privateKey: string; passphrase?: string }

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

const refusedCodes = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']

const unreachableHostCodes = new Set([...refusedCodes, 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'])

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

const connectionFailureReasonSchema = z
  .object({ code: z.string() })
  .transform(({ code }) => networkReason(code) ?? 'hostUnreachable')
  .catch('hostUnreachable')

const resolvedAddresses = (host: string, { resolve }: AddressPolicy) =>
  Effect.tryPromise({
    try: () => resolve(host),
    catch: (error) => unreachable(connectionFailureReasonSchema.parse(error)),
  })

// Connecting to the checked addresses, not the host name, keeps a second lookup from rebinding them.
const connectAddresses = (
  host: string,
  addressPolicy: AddressPolicy,
): Effect.Effect<readonly string[], ChannelUnreachable> =>
  Effect.flatMap(resolvedAddresses(host, addressPolicy), (addresses) => {
    const blockedAddress = blockedAddressOf(addressPolicy, host, addresses)

    return blockedAddress === undefined
      ? Effect.succeed(addresses)
      : Effect.fail(new ChannelUnreachable({ reason: 'addressBlocked', blockedAddress }))
  })

class ConnectFailed extends Data.TaggedError('ConnectFailed')<{
  readonly reason: ChannelTestFailureReason
}> {}

const connectFailureCodes = new Set([...refusedCodes, ...timedOutCodes])

const connectFailedAsUnreachable = <A>(
  effect: Effect.Effect<A, ChannelUnreachable | ConnectFailed>,
) => Effect.catchTag(effect, 'ConnectFailed', ({ reason }) => Effect.fail(unreachable(reason)))

// An equal share of the timeout per address leaves a silent first address time for the next.
const firstConnecting = <A>(
  addresses: readonly string[],
  timeoutMs: number,
  attempt: (
    address: string,
    connectTimeoutMs: number,
  ) => Effect.Effect<A, ChannelUnreachable | ConnectFailed>,
): Effect.Effect<A, ChannelUnreachable> => {
  const connectTimeoutMs = timeoutMs / Math.max(addresses.length, 1)

  const tryFrom = (index: number): Effect.Effect<A, ChannelUnreachable> => {
    const address = addresses[index]

    if (address === undefined) {
      return Effect.fail(unreachable('hostUnreachable'))
    }

    const attempted = attempt(address, connectTimeoutMs)

    return index + 1 < addresses.length
      ? Effect.catchTag(attempted, 'ConnectFailed', () => tryFrom(index + 1))
      : connectFailedAsUnreachable(attempted)
  }

  return tryFrom(0)
}

export interface ConnectOptions {
  timeoutMs: number
  addressPolicy: AddressPolicy
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

type SshAuthentication = Pick<ConnectConfig, 'password' | 'authHandler'>

const sshAuthentication = ({
  username,
  credential,
}: SftpLogin): Effect.Effect<SshAuthentication, ChannelUnreachable> => {
  if ('password' in credential) {
    return Effect.succeed({ password: credential.password })
  }

  const unlocked = unlockedKey(credential)

  return 'reason' in unlocked
    ? Effect.fail(unreachable(unlocked.reason))
    : Effect.succeed({ authHandler: [{ type: 'publickey', username, key: unlocked.key }] })
}

export type SftpUse<A> = (
  sftp: SFTPWrapper,
  done: (outcome: Effect.Effect<A, ChannelUnreachable>) => void,
  hostKey: TestedHostKey,
) => void

// Unchecked without a fingerprint, so Channels set up before host key checks keep working.
export const sftpSession = <A>(
  login: SftpLogin,
  { timeoutMs, addressPolicy }: ConnectOptions,
  use: SftpUse<A>,
) =>
  Effect.flatMap(connectAddresses(login.host, addressPolicy), (addresses) =>
    Effect.flatMap(sshAuthentication(login), (authentication) =>
      firstConnecting(addresses, timeoutMs, (address, connectTimeoutMs) =>
        Effect.scoped(
          Effect.flatMap(tcpConnection(address, login.port, connectTimeoutMs), (socket) =>
            sshSession(socket, login, authentication, timeoutMs, use),
          ),
        ),
      ),
    ),
  )

// The connect wait and ssh2 report socket errors; this keeps a late one from crashing the process.
const ignoreSocketError = () => {}

// The scope destroys the socket on every path, also when ssh2 refuses the login before taking it.
const openedSocket = (host: string, port: number) =>
  Effect.acquireRelease(
    Effect.sync(() => connect({ host, port }).on('error', ignoreSocketError)),
    (socket) => Effect.sync(() => socket.destroy()),
  )

const socketConnecting = (socket: Socket, connectTimeoutMs: number) =>
  Effect.callback<Socket, ConnectFailed>((resume) => {
    const timer = setTimeout(() => {
      resume(Effect.fail(new ConnectFailed({ reason: 'timedOut' })))
    }, connectTimeoutMs)

    const onError = (error: Error) => {
      clearTimeout(timer)
      resume(Effect.fail(new ConnectFailed({ reason: connectionFailureReasonSchema.parse(error) })))
    }

    socket.once('error', onError)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
      resume(Effect.succeed(socket))
    })

    return Effect.sync(() => {
      clearTimeout(timer)
      socket.removeListener('error', onError)
    })
  })

const tcpConnection = (host: string, port: number, connectTimeoutMs: number) =>
  Effect.flatMap(openedSocket(host, port), (socket) => socketConnecting(socket, connectTimeoutMs))

const sshSession = <A>(
  socket: Socket,
  login: SftpLogin,
  authentication: SshAuthentication,
  timeoutMs: number,
  use: SftpUse<A>,
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

    client.connect({
      sock: socket,
      username: login.username,
      readyTimeout: timeoutMs,
      hostVerifier: (key: Buffer) => {
        const fingerprint = fingerprintOf(key)
        hostKey = { fingerprint, state: hostKeyState(fingerprint, login.hostKeyFingerprint) }

        return hostKey.state !== 'mismatch'
      },
      ...authentication,
    })

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

const fetchFailure = z
  .object({ cause: z.object({ code: z.string() }) })
  .transform(({ cause: { code } }) => code)
  .optional()
  .catch(undefined)

// A socket error can also end a request already sent, so only one that never connected moves on.
const requestFailure = (code: string | undefined, neverConnected: boolean) => {
  const reason = networkReason(code) ?? 'unexpectedResponse'

  return neverConnected && code !== undefined && connectFailureCodes.has(code)
    ? new ConnectFailed({ reason })
    : unreachable(reason)
}

const pinnedLookup =
  (address: string): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family: isIP(address) }])
    } else {
      callback(null, address, isIP(address))
    }
  }

interface PinnedAgent {
  readonly agent: Agent
  readonly connected: () => boolean
}

const pinnedAgent = (address: string, connectTimeoutMs: number): PinnedAgent => {
  const connector = buildConnector({ lookup: pinnedLookup(address), timeout: connectTimeoutMs })
  let connected = false

  const agent = new Agent({
    connect: (options, callback) => {
      connector(options, (...args) => {
        connected ||= args[0] === null
        callback(...args)
      })
    },
  })

  return { agent, connected: () => connected }
}

const requesting = (url: string, init: RequestInit, pinned: PinnedAgent) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal,
        dispatcher: pinned.agent,
      })

      // An unread body holds its keep-alive connection until garbage collection.
      await response.body?.cancel()

      return response
    },
    catch: (error) => requestFailure(fetchFailure.parse(error), !pinned.connected()),
  })

// The URL keeps its host name, so TLS still checks the certificate against it.
export const httpRequest = (
  url: string,
  init: RequestInit,
  { timeoutMs, addressPolicy }: ConnectOptions,
) => {
  const host = URL.parse(url)?.hostname.replace(/^\[(.*)\]$/, '$1')

  if (host === undefined) {
    return Effect.fail(unreachable('hostUnreachable'))
  }

  return Effect.flatMap(connectAddresses(host, addressPolicy), (addresses) =>
    firstConnecting(addresses, timeoutMs, (address, connectTimeoutMs) =>
      Effect.acquireUseRelease(
        Effect.sync(() => pinnedAgent(address, connectTimeoutMs)),
        (pinned) => requesting(url, init, pinned),
        ({ agent }) => Effect.promise(() => agent.destroy()),
      ),
    ),
  )
}

// HEAD sends no Document; an endpoint that only accepts POST still answers it.
const reachHttp = ({ url, authorization }: HttpDestination, options: ConnectOptions) =>
  httpRequest(
    url,
    { method: 'HEAD', headers: authorization === null ? {} : { authorization } },
    options,
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

export const channelReach = (options: ConnectOptions) =>
  ChannelReach.of({
    sftp: (login) => timingOut(reachSftp(login, options), options.timeoutMs),
    http: (destination) => timingOut(reachHttp(destination, options), options.timeoutMs),
  })
