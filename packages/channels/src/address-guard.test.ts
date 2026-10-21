import { Effect } from 'effect'
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer as createTcpServer, type Socket } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  addressPolicy,
  channelReach,
  DeliveryFailed,
  DownloadFailed,
  type HostResolver,
  type HttpDestination,
  httpChannelDelivery,
  listSftp,
  postHttp,
  secretBox,
  secretKeyBytes,
  sftpChannelDelivery,
  sftpChannelDownload,
  type SftpLogin,
  uploadSftp,
} from './index'
import {
  listening,
  startTestErp,
  startTestSftpServer,
  type TestErp,
  type TestSftpServer,
} from './testing'

// Host names under .test never resolve in public DNS, so only this resolver knows them.
const resolving =
  (name: string, ...addresses: string[]): HostResolver =>
  (host) =>
    host === name
      ? Promise.resolve(addresses)
      : Promise.reject(
          Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }),
        )

const timeoutMs = 1500

let erp: TestErp

let sftp: TestSftpServer

beforeAll(async () => {
  ;[erp, sftp] = await Promise.all([startTestErp(), startTestSftpServer()])
}, 180_000)

afterAll(async () => {
  await Promise.all([erp.stop(), sftp.stop()])
})

beforeEach(() => {
  erp.received.length = 0
})

const succeeded = <E>(effect: Effect.Effect<unknown, E>) =>
  Effect.runPromise(Effect.as(effect, 'succeeded'))

const erpPort = () => new URL(erp.url).port

const failure = <E>(effect: Effect.Effect<unknown, E>) => Effect.runPromise(Effect.flip(effect))

const sftpLoginAt = (host: string, port = 22): SftpLogin => ({
  host,
  port,
  username: 'edi_bridge',
  credential: { password: 'edi-bridge-sftp-password' },
  remotePath: '/upload',
  hostKeyFingerprint: null,
})

const httpAt = (url: string): HttpDestination => ({ url, authorization: null })

const urlHost = (address: string) => (address.includes(':') ? `[${address}]` : address)

const blockedAddresses = [
  '127.0.0.1',
  '127.8.9.10',
  '10.0.4.17',
  '172.16.0.1',
  '172.31.255.254',
  '192.168.1.10',
  '169.254.169.254',
  '0.0.0.0',
  '::1',
  '::',
  'fe80::1',
  'fd00::7',
  'fc00::1',
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:169.254.169.254',
  '100.64.0.1',
  '100.127.255.254',
  '::127.0.0.1',
  '::a00:1',
  '64:ff9b::a9fe:a9fe',
  '64:ff9b::6440:1',
  '64:ff9b:1::808:808',
  '2002:a00:1::',
  '2002:7f00:1::1',
  '::ffff:0:127.0.0.1',
  '::ffff:0:a00:1',
]

// A URL writes an IPv4-mapped IPv6 address in hexadecimal.
const urlForms = new Map([
  ['::ffff:127.0.0.1', '::ffff:7f00:1'],
  ['::ffff:10.0.0.1', '::ffff:a00:1'],
  ['::ffff:169.254.169.254', '::ffff:a9fe:a9fe'],
  ['::127.0.0.1', '::7f00:1'],
  ['::ffff:0:127.0.0.1', '::ffff:0:7f00:1'],
])

describe('channelReach with an address policy', () => {
  const reach = channelReach({ timeoutMs, addressPolicy: addressPolicy([]) })

  it('refuses an SFTP Channel at a loopback, link-local, private or unspecified address', async () => {
    for (const address of blockedAddresses) {
      expect(await failure(reach.sftp(sftpLoginAt(address)))).toMatchObject({
        reason: 'addressBlocked',
        blockedAddress: address,
      })
    }
  })

  it('refuses an HTTP Channel at a loopback, link-local, private or unspecified address', async () => {
    for (const address of blockedAddresses) {
      expect(await failure(reach.http(httpAt(`http://${urlHost(address)}:8080/`)))).toMatchObject({
        reason: 'addressBlocked',
        blockedAddress: urlForms.get(address) ?? address,
      })
    }

    expect(erp.received).toHaveLength(0)
  })
})

describe('channelReach for a host name', () => {
  const reachVia = (resolve?: HostResolver) =>
    channelReach({ timeoutMs, addressPolicy: addressPolicy([], resolve) })

  it('refuses a host name that resolves to a loopback address', async () => {
    const failed = await failure(reachVia().sftp(sftpLoginAt('localhost')))

    expect(failed).toMatchObject({ reason: 'addressBlocked' })
    expect(['127.0.0.1', '::1']).toContain(failed.blockedAddress)
  })

  it('refuses a host name that resolves to a blocked address', async () => {
    const reach = reachVia(resolving('sftp.partner.test', '10.0.4.17'))

    expect(await failure(reach.sftp(sftpLoginAt('sftp.partner.test')))).toMatchObject({
      reason: 'addressBlocked',
      blockedAddress: '10.0.4.17',
    })
  })

  it('refuses a host name when any of its addresses is blocked', async () => {
    const reach = reachVia(resolving('erp.partner.test', '203.0.113.5', '169.254.169.254'))

    expect(await failure(reach.http(httpAt('http://erp.partner.test/')))).toMatchObject({
      reason: 'addressBlocked',
      blockedAddress: '169.254.169.254',
    })
  })

  it('refuses an HTTP Channel whose URL has no host it can check', async () => {
    expect(await failure(reachVia().http(httpAt('not a url')))).toMatchObject({
      reason: 'hostUnreachable',
    })
  })

  it('reports a host name that does not resolve as unreachable', async () => {
    expect(await failure(reachVia().sftp(sftpLoginAt('sftp.nowhere.test')))).toMatchObject({
      reason: 'hostUnreachable',
    })
  })
})

// Each form embeds 8.8.8.8, so a lookup that also returns them still reaches the allowed address.
const embeddedPublicAddresses = [
  '::808:808',
  '64:ff9b::808:808',
  '2002:808:808::',
  '::ffff:0:808:808',
]

describe('channelReach for IPv6 forms that embed an IPv4 address', () => {
  const reachVia = (allowedHosts: string[], ...addresses: string[]) =>
    channelReach({
      timeoutMs,
      addressPolicy: addressPolicy(allowedHosts, resolving('erp.partner.test', ...addresses)),
    })

  const erpByName = () => httpAt(`http://erp.partner.test:${erpPort()}/`)

  it('reaches a host whose IPv6 addresses embed a public IPv4 address', async () => {
    for (const address of embeddedPublicAddresses) {
      expect(await succeeded(reachVia(['127.0.0.1'], '127.0.0.1', address).http(erpByName()))).toBe(
        'succeeded',
      )
    }
  })

  it('allows an IPv6 form whose embedded IPv4 address is on the allow list', async () => {
    for (const address of ['::a00:1', '64:ff9b::a00:1', '2002:a00:1::', '::ffff:0:a00:1']) {
      expect(
        await succeeded(
          reachVia(['127.0.0.1', '10.0.0.0/8'], '127.0.0.1', address).http(erpByName()),
        ),
      ).toBe('succeeded')
    }
  })
})

describe('channelReach with an allow list', () => {
  it('reaches an allowed address', async () => {
    const reach = channelReach({ timeoutMs, addressPolicy: addressPolicy(['127.0.0.1']) })

    expect(await succeeded(reach.http(httpAt(erp.url)))).toBe('succeeded')
  })

  it('reaches an address in an allowed range', async () => {
    const reach = channelReach({ timeoutMs, addressPolicy: addressPolicy(['127.0.0.0/8']) })

    expect(await succeeded(reach.http(httpAt(erp.url)))).toBe('succeeded')
    expect(await failure(reach.http(httpAt('http://10.0.4.17/')))).toMatchObject({
      reason: 'addressBlocked',
      blockedAddress: '10.0.4.17',
    })
  })

  it('reaches every address of an allowed host name', async () => {
    const reach = channelReach({
      timeoutMs,
      addressPolicy: addressPolicy(
        ['ERP.Partner.test'],
        resolving('erp.partner.test', '127.0.0.1', '10.0.4.17'),
      ),
    })

    expect(await succeeded(reach.http(httpAt(`http://erp.partner.test:${erpPort()}/`)))).toBe(
      'succeeded',
    )
  })

  it('matches an allowed host name with or without a trailing dot', async () => {
    const reachVia = (allowedHost: string, channelHost: string) =>
      channelReach({
        timeoutMs,
        addressPolicy: addressPolicy([allowedHost], resolving(channelHost, '127.0.0.1')),
      })

    for (const [allowedHost, channelHost] of [
      ['erp.partner.test.', 'erp.partner.test'],
      ['erp.partner.test', 'erp.partner.test.'],
    ] as const) {
      expect(
        await succeeded(
          reachVia(allowedHost, channelHost).http(httpAt(`http://${channelHost}:${erpPort()}/`)),
        ),
      ).toBe('succeeded')
    }
  })
})

describe('channelReach connects to the checked address', () => {
  const reachVia = (name: string) =>
    channelReach({
      timeoutMs,
      addressPolicy: addressPolicy(['127.0.0.1'], resolving(name, '127.0.0.1')),
    })

  it('sends an HTTP request to the checked address under the host name of the Channel', async () => {
    const reach = reachVia('erp.partner.test')

    expect(await succeeded(reach.http(httpAt(`http://erp.partner.test:${erpPort()}/`)))).toBe(
      'succeeded',
    )
    expect(erp.received[0]?.headers.host).toBe(`erp.partner.test:${erpPort()}`)
  })

  it('opens the SFTP session at the checked address', async () => {
    const reach = reachVia('sftp.partner.test')

    expect(
      await succeeded(
        reach.sftp({
          ...sftpLoginAt('sftp.partner.test', sftp.port),
          credential: { password: sftp.password },
        }),
      ),
    ).toBe('succeeded')
  })
})

const order = { name: 'orders-42-1.json', content: Buffer.from('{"orderNumber":"PO-4711"}') }

// The test servers listen on 127.0.0.1 only, so 127.0.0.2 and 127.0.0.3 refuse the connection.
const countingLookups = (name: string, ...addresses: string[]) => {
  const lookups: string[] = []

  const resolve: HostResolver = (host) => {
    lookups.push(host)

    return resolving(name, ...addresses)(host)
  }

  return { lookups, resolve }
}

// Forwards to the SFTP container from 127.0.0.1 only and counts the connections it accepts.
const startSftpForwarder = async () => {
  const connections: Socket[] = []

  const forwarder = createTcpServer((socket) => {
    connections.push(socket)

    const upstream = connect(sftp.port, sftp.host)

    socket.pipe(upstream).pipe(socket)
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
  })

  const port = await listening(forwarder)

  return {
    port,
    connections,
    stop: () => {
      forwarder.close()
    },
  }
}

describe('channelReach tries the checked addresses in order', () => {
  const reachVia = (resolve: HostResolver) =>
    channelReach({ timeoutMs, addressPolicy: addressPolicy(['127.0.0.0/8'], resolve) })

  it('sends an HTTP request to the next address when the first refuses', async () => {
    const { lookups, resolve } = countingLookups('erp.partner.test', '127.0.0.2', '127.0.0.1')

    expect(
      await succeeded(reachVia(resolve).http(httpAt(`http://erp.partner.test:${erpPort()}/`))),
    ).toBe('succeeded')
    expect(erp.received[0]?.headers.host).toBe(`erp.partner.test:${erpPort()}`)
    expect(lookups).toEqual(['erp.partner.test'])
  })

  it('posts a delivery to the next address when the first refuses', async () => {
    const { resolve } = countingLookups('erp.partner.test', '127.0.0.2', '127.0.0.1')

    await Effect.runPromise(
      postHttp(httpAt(`http://erp.partner.test:${erpPort()}/`), order, {
        timeoutMs,
        addressPolicy: addressPolicy(['127.0.0.0/8'], resolve),
      }),
    )

    expect(erp.received).toHaveLength(1)
  })

  it('does not post a delivery to the next address after the connection opened', async () => {
    const connections: Socket[] = []

    const resetting = createTcpServer((socket) => {
      connections.push(socket)
      socket.once('data', () => socket.resetAndDestroy())
    })

    const port = await listening(resetting)
    const { resolve } = countingLookups('erp.partner.test', '127.0.0.1', '127.0.0.1')

    try {
      expect(
        await failure(
          postHttp(httpAt(`http://erp.partner.test:${port}/`), order, {
            timeoutMs,
            addressPolicy: addressPolicy(['127.0.0.0/8'], resolve),
          }),
        ),
      ).toMatchObject({ reason: 'hostUnreachable' })
      expect(connections).toHaveLength(1)
    } finally {
      resetting.close()
    }
  })

  it('does not send an HTTP request again after an answer it rejects', async () => {
    const { resolve } = countingLookups('erp.partner.test', '127.0.0.1', '127.0.0.1')

    expect(
      await failure(
        reachVia(resolve).http(httpAt(`http://erp.partner.test:${erpPort()}/?status=500`)),
      ),
    ).toMatchObject({ reason: 'unexpectedResponse' })
    expect(erp.received).toHaveLength(1)
  })

  it('reports a host whose every address refuses as unreachable', async () => {
    const { resolve } = countingLookups('erp.partner.test', '127.0.0.2', '127.0.0.3')

    expect(
      await failure(reachVia(resolve).http(httpAt(`http://erp.partner.test:${erpPort()}/`))),
    ).toMatchObject({ reason: 'hostUnreachable' })
  })

  it('opens the SFTP session at the next address when the first refuses', async () => {
    const forwarder = await startSftpForwarder()
    const { lookups, resolve } = countingLookups('sftp.partner.test', '127.0.0.2', '127.0.0.1')

    try {
      expect(
        await succeeded(
          reachVia(resolve).sftp({
            ...sftpLoginAt('sftp.partner.test', forwarder.port),
            credential: { password: sftp.password },
          }),
        ),
      ).toBe('succeeded')
      expect(forwarder.connections).toHaveLength(1)
      expect(lookups).toEqual(['sftp.partner.test'])
    } finally {
      forwarder.stop()
    }
  })

  it('opens no connection when the private key cannot be parsed', async () => {
    const forwarder = await startSftpForwarder()
    const { resolve } = countingLookups('sftp.partner.test', '127.0.0.1')

    try {
      expect(
        await failure(
          reachVia(resolve).sftp({
            ...sftpLoginAt('sftp.partner.test', forwarder.port),
            credential: { privateKey: 'not a private key' },
          }),
        ),
      ).toMatchObject({ reason: 'loginRejected' })
      expect(forwarder.connections).toEqual([])
    } finally {
      forwarder.stop()
    }
  })

  it('does not open another SFTP session after a rejected login', async () => {
    const forwarder = await startSftpForwarder()
    const { resolve } = countingLookups('sftp.partner.test', '127.0.0.1', '127.0.0.1')

    try {
      expect(
        await failure(
          reachVia(resolve).sftp({
            ...sftpLoginAt('sftp.partner.test', forwarder.port),
            credential: { password: 'wrong-password' },
          }),
        ),
      ).toMatchObject({ reason: 'loginRejected' })
      expect(forwarder.connections).toHaveLength(1)
    } finally {
      forwarder.stop()
    }
  })
})

const blocking = { timeoutMs, addressPolicy: addressPolicy([]) }

const blockedDelivery = (address: string) =>
  new DeliveryFailed({
    reason: 'addressBlocked',
    details: { kind: 'blockedAddress', address },
  })

describe('a delivery with an address policy', () => {
  it('refuses to post to a blocked address and names it in the details', async () => {
    expect(
      await failure(postHttp(httpAt('http://169.254.169.254/latest/'), order, blocking)),
    ).toEqual(blockedDelivery('169.254.169.254'))
  })

  it('refuses to upload to a blocked address and names it in the details', async () => {
    expect(await failure(uploadSftp(sftpLoginAt('fd00::7'), order, blocking))).toEqual(
      blockedDelivery('fd00::7'),
    )
  })

  it('posts to an allowed address', async () => {
    await Effect.runPromise(
      postHttp(httpAt(erp.url), order, { timeoutMs, addressPolicy: addressPolicy(['127.0.0.1']) }),
    )

    expect(erp.received).toHaveLength(1)
  })

  it('does not follow a redirect to a blocked address', async () => {
    const redirecting = createHttpServer((_request, response) => {
      response.writeHead(307, { location: erp.url }).end()
    })

    const port = await listening(redirecting)

    const options = {
      timeoutMs,
      addressPolicy: addressPolicy(
        ['erp.partner.test'],
        resolving('erp.partner.test', '127.0.0.1'),
      ),
    }

    try {
      expect(
        await failure(postHttp(httpAt(`http://erp.partner.test:${port}/`), order, options)),
      ).toEqual(
        new DeliveryFailed({
          reason: 'unexpectedResponse',
          details: { kind: 'httpResponse', status: 307 },
        }),
      )

      expect(
        await succeeded(channelReach(options).http(httpAt(`http://erp.partner.test:${port}/`))),
      ).toBe('succeeded')

      expect(erp.received).toHaveLength(0)
    } finally {
      redirecting.close()
    }
  })
})

describe('a download with an address policy', () => {
  it('refuses to list the files at a blocked address and names it', async () => {
    expect(await failure(listSftp(sftpLoginAt('192.168.1.10'), blocking))).toEqual(
      new DownloadFailed({ reason: 'addressBlocked', blockedAddress: '192.168.1.10' }),
    )
  })
})

const secrets = secretBox(Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'))

const channelId = '3e7b9d14-5a2c-4f86-b1d0-8c4e2a6f9b57'

const sftpChannel = {
  id: channelId,
  host: '10.0.4.17',
  port: 22,
  username: 'edi_bridge',
  remotePath: '/upload',
  authentication: 'password' as const,
  encryptedCredential: secrets.seal('password', `channels/${channelId}/encryptedCredential`),
  hostKeyFingerprint: null,
}

describe('the Channel deliveries and download with an address policy', () => {
  it('refuses an SFTP Channel at a blocked address', async () => {
    expect(
      await failure(sftpChannelDelivery({ secrets, ...blocking })(sftpChannel, order)),
    ).toEqual(blockedDelivery('10.0.4.17'))
    expect(await failure(sftpChannelDownload({ secrets, ...blocking }).list(sftpChannel))).toEqual(
      new DownloadFailed({ reason: 'addressBlocked', blockedAddress: '10.0.4.17' }),
    )
  })

  it('refuses an HTTP Channel at a blocked address', async () => {
    expect(
      await failure(
        httpChannelDelivery({ secrets, ...blocking })(
          { id: channelId, url: 'http://[::1]:8080/', encryptedAuthorization: null },
          order,
        ),
      ),
    ).toEqual(blockedDelivery('::1'))
  })
})
