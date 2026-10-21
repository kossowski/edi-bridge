import { createPrivateKey, generateKeyPairSync } from 'node:crypto'
import { createServer as createHttpServer, type IncomingHttpHeaders } from 'node:http'
import { utils } from 'ssh2'
import { GenericContainer, Wait } from 'testcontainers'
import { z } from 'zod'

import type { Server } from 'node:net'

import { hostKeyFingerprintSchema } from '@edi-bridge/contracts'

import { addressPolicy } from './address-guard'

const sftpImage =
  'atmoz/sftp:alpine@sha256:7e439fabeae536fa254340724c042e11999924d906417dbb5c73602ad518813f'

// The test servers and Testcontainers listen on the loopback interface of the test machine.
export const testAllowedHosts = ['localhost', '127.0.0.1', '::1']

export const testAddressPolicy = addressPolicy(testAllowedHosts)

export const listening = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return z.object({ port: z.number() }).parse(server.address()).port
}

// ssh2 drops a leading zero byte of the public key, so about one Ed25519 pair in 256 is malformed.
export const sshKeyPair = (passphrase?: string): utils.KeyPairReturn => {
  const pair = utils.generateKeyPairSync(
    'ed25519',
    passphrase === undefined ? {} : { passphrase, cipher: 'aes256-ctr', rounds: 16 },
  )

  return utils.parseKey(pair.public) instanceof Error ? sshKeyPair(passphrase) : pair
}

// A passphrase that does not unlock the protected key of the test SFTP server.
export const wrongPassphrase = 'wrong-key-passphrase'

const legacyPem = (passphrase: string) =>
  ({ type: 'sec1', format: 'pem', cipher: 'aes-256-cbc', passphrase }) as const

// An older key with a Proc-Type: 4,ENCRYPTED header, as ssh-keygen -m PEM or OpenSSL write it.
export const legacyPemKeyPair = (passphrase: string) => {
  const privateKey = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: legacyPem(passphrase),
  }).privateKey

  const parsed = utils.parseKey(privateKey, passphrase)

  if (parsed instanceof Error) {
    throw parsed
  }

  return { privateKey, public: `${parsed.type} ${parsed.getPublicSSH().toString('base64')}` }
}

// A wrong passphrase can decrypt a legacy PEM key into bytes ssh2 still parses; this one always does.
export const keyUnlockedByWrongPassphrase = () => {
  const rsaKey = () =>
    generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' })

  const mismatched = createPrivateKey({
    key: { ...rsaKey(), n: z.string().parse(rsaKey().n) },
    format: 'jwk',
  })

  return {
    privateKey: z
      .string()
      .parse(mismatched.export({ ...legacyPem(wrongPassphrase), type: 'pkcs1' })),
    passphrase: wrongPassphrase,
  }
}

export async function startTestSftpServer() {
  const username = 'edi_bridge'
  const password = 'edi-bridge-sftp-password'
  const passphrase = 'edi-bridge-key-passphrase'
  const keyPair = sshKeyPair()
  const protectedKeyPair = sshKeyPair(passphrase)
  const legacyKeyPair = legacyPemKeyPair(passphrase)

  const container = await new GenericContainer(sftpImage)
    .withPlatform('linux/amd64')
    .withCommand([`${username}:${password}:::upload`])
    .withCopyContentToContainer([
      { content: `${keyPair.public}\n`, target: `/home/${username}/.ssh/keys/id.pub` },
      {
        content: `${protectedKeyPair.public}\n`,
        target: `/home/${username}/.ssh/keys/protected.pub`,
      },
      { content: `${legacyKeyPair.public}\n`, target: `/home/${username}/.ssh/keys/legacy.pub` },
    ])
    .withExposedPorts(22)
    .withWaitStrategy(Wait.forLogMessage(/Server listening on/))
    .start()

  // ssh2 prefers an Ed25519 host key, so that is the one the server presents.
  const { output } = await container.exec([
    'ssh-keygen',
    '-lf',
    '/etc/ssh/ssh_host_ed25519_key.pub',
  ])

  const hostKeyFingerprint = hostKeyFingerprintSchema.parse(/SHA256:\S+/.exec(output)?.[0])

  return {
    host: container.getHost(),
    port: container.getMappedPort(22),
    username,
    password,
    privateKey: keyPair.private,
    protectedKey: { privateKey: protectedKeyPair.private, passphrase },
    legacyKey: { privateKey: legacyKeyPair.privateKey, passphrase },
    hostKeyFingerprint,
    home: `/home/${username}`,
    exec: async (command: string) => container.exec(['sh', '-c', command]),
    stop: async () => {
      await container.stop()
    },
  }
}

export type TestSftpServer = Awaited<ReturnType<typeof startTestSftpServer>>

// A well-formed fingerprint that matches no host key of the test SFTP server.
export const mismatchingHostKeyFingerprint = hostKeyFingerprintSchema.parse(
  `SHA256:${'A'.repeat(43)}`,
)

export interface ReceivedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: string
}

// Answers each request with the status of its `status` query parameter, 200 without one.
export async function startTestErp() {
  const received: ReceivedRequest[] = []

  const server = createHttpServer((request, response) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      received.push({ method: request.method, url: request.url, headers: request.headers, body })

      const status = Number(new URL(request.url ?? '/', 'http://erp').searchParams.get('status'))

      response.writeHead(status || 200).end()
    })
  })

  const port = await listening(server)

  return {
    url: `http://127.0.0.1:${String(port)}/api/edi/documents`,
    received,
    stop: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

export type TestErp = Awaited<ReturnType<typeof startTestErp>>
