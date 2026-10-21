import { describe, expect, it } from 'vitest'

import {
  acceptHostKeyEndpoint,
  type Channel,
  type ChannelInput,
  channelInputSchema,
  channelKinds,
  channelSchema,
  channelSummarySchema,
  channelTestResultSchema,
  channelUpdateSchema,
  createdChannelSchema,
  hostKeyFingerprintSchema,
  webhookAuthorization,
  webhookTokenHeader,
  webhookTokenSchema,
} from './channel'

const tradingPartnerId = '00000001-0000-4000-8000-000000000001'

const inboundSftp: Extract<ChannelInput, { type: 'sftp'; direction: 'inbound' }> = {
  type: 'sftp',
  direction: 'inbound',
  name: 'Hansemarkt SFTP inbox',
  tradingPartnerId,
  host: 'sftp.hansemarkt.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  credential: 'correct horse battery staple',
  pollingIntervalMinutes: 1,
}

const outboundSftp: ChannelInput = {
  type: 'sftp',
  direction: 'outbound',
  name: 'Hansemarkt SFTP outbox',
  tradingPartnerId,
  host: 'sftp.hansemarkt.example',
  port: 2222,
  username: 'nordwind',
  remotePath: '/inbox',
  authentication: 'privateKey',
  credential: '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----',
}

const webhook: ChannelInput = {
  type: 'webhook',
  direction: 'inbound',
  name: 'ERP webhook',
  tradingPartnerId: null,
  rateLimitPerMinute: 60,
}

const http: Extract<ChannelInput, { type: 'http' }> = {
  type: 'http',
  direction: 'outbound',
  name: 'ERP HTTP delivery',
  tradingPartnerId: null,
  url: 'https://erp.nordwind.example/edi',
  authorization: 'Bearer s3cr3t',
}

const webhookChannel: Channel = {
  id: '00000003-0000-4000-8000-000000000001',
  type: 'webhook',
  direction: 'inbound',
  name: 'ERP webhook',
  tradingPartnerId: null,
  rateLimitPerMinute: 60,
  url: 'https://api.edi-bridge.example/webhooks/00000003-0000-4000-8000-000000000001',
  token: { lastFour: 'a1B2' },
}

const sftpChannel: Channel = {
  id: '00000003-0000-4000-8000-000000000003',
  type: 'sftp',
  direction: 'inbound',
  name: 'Hansemarkt SFTP inbox',
  tradingPartnerId,
  host: 'sftp.hansemarkt.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  credential: { lastFour: null },
  pollingIntervalMinutes: 1,
  pollProblem: null,
}

describe('channelInputSchema', () => {
  it.each([inboundSftp, outboundSftp, webhook, http])(
    'accepts a $direction $type Channel',
    (input) => {
      expect(channelInputSchema.parse(input)).toEqual(input)
    },
  )

  it.each([
    { ...webhook, direction: 'outbound' },
    { ...http, direction: 'inbound' },
  ])('rejects a $direction $type Channel', (input) => {
    expect(channelInputSchema.safeParse(input).success).toBe(false)
  })

  it('lists the four Channel kinds the schema accepts', () => {
    const inputs = [inboundSftp, outboundSftp, webhook, http]

    expect(inputs.map(({ type, direction }) => ({ type, direction }))).toEqual(channelKinds)
  })

  it('polls every minute when the polling interval is omitted', () => {
    const withoutPollingInterval = { ...inboundSftp, pollingIntervalMinutes: undefined }

    expect(channelInputSchema.parse(withoutPollingInterval)).toMatchObject({
      pollingIntervalMinutes: 1,
    })
  })

  it('requires the SFTP credential when creating a Channel', () => {
    const withoutCredential = { ...inboundSftp, credential: undefined }

    expect(channelInputSchema.safeParse(withoutCredential).success).toBe(false)
  })

  it('only accepts polling intervals from one minute to one day', () => {
    for (const [pollingIntervalMinutes, valid] of [
      [0, false],
      [1, true],
      [1440, true],
      [1441, false],
      [1.5, false],
    ] as const) {
      expect(channelInputSchema.safeParse({ ...inboundSftp, pollingIntervalMinutes }).success).toBe(
        valid,
      )
    }
  })

  it('rejects a remote path that is not absolute and a host with a scheme', () => {
    expect(channelInputSchema.safeParse({ ...inboundSftp, remotePath: 'outbox' }).success).toBe(
      false,
    )
    expect(
      channelInputSchema.safeParse({ ...inboundSftp, host: 'sftp://sftp.hansemarkt.example' })
        .success,
    ).toBe(false)
  })

  it('only accepts HTTP and HTTPS delivery URLs', () => {
    expect(channelInputSchema.safeParse({ ...http, url: 'ftp://erp.example/edi' }).success).toBe(
      false,
    )
  })
})

describe('channelUpdateSchema', () => {
  it('keeps the stored secrets when the update omits them', () => {
    const sftpWithoutCredential = { ...inboundSftp, credential: undefined }
    const httpWithoutAuthorization = { ...http, authorization: undefined }

    expect(channelUpdateSchema.safeParse(sftpWithoutCredential).success).toBe(true)
    expect(channelUpdateSchema.safeParse(httpWithoutAuthorization).success).toBe(true)
  })

  it('rejects an empty secret', () => {
    expect(channelUpdateSchema.safeParse({ ...inboundSftp, credential: '' }).success).toBe(false)
  })
})

describe('channelSchema', () => {
  it.each([webhookChannel, sftpChannel])('accepts a masked $type Channel', (channel) => {
    expect(channelSchema.parse(channel)).toEqual(channel)
  })

  it('rejects a response that contains a plaintext secret', () => {
    expect(channelSchema.safeParse({ ...sftpChannel, credential: 'hunter2' }).success).toBe(false)
    expect(channelSchema.safeParse({ ...sftpChannel, password: 'hunter2' }).success).toBe(false)
    expect(
      channelSchema.safeParse({ ...webhookChannel, token: { lastFour: 'a1B2', value: 'x' } })
        .success,
    ).toBe(false)
    expect(
      channelSchema.safeParse({ ...webhookChannel, token: `whk_${'a'.repeat(32)}` }).success,
    ).toBe(false)
  })

  it('reveals at most the last four characters of a secret', () => {
    expect(
      channelSchema.safeParse({ ...webhookChannel, token: { lastFour: 'a1B2c3' } }).success,
    ).toBe(false)
  })

  it('still satisfies the Channel summary', () => {
    expect(channelSummarySchema.parse(sftpChannel)).toEqual({
      id: sftpChannel.id,
      name: sftpChannel.name,
      type: 'sftp',
      direction: 'inbound',
      tradingPartnerId,
    })
  })
})

describe('the poll problem of a Channel', () => {
  const pollProblem = { reason: 'hostKeyMismatch', since: '2026-10-20T07:15:00.000Z' } as const

  const outboundSftpChannel = {
    id: sftpChannel.id,
    type: 'sftp',
    direction: 'outbound',
    name: 'Hansemarkt SFTP outbox',
    tradingPartnerId,
    host: 'sftp.hansemarkt.example',
    port: 22,
    username: 'nordwind',
    remotePath: '/inbox',
    authentication: 'password',
    credential: { lastFour: null },
  }

  it('carries the reason and the first failure on an inbound SFTP Channel', () => {
    expect(channelSchema.parse({ ...sftpChannel, pollProblem })).toMatchObject({ pollProblem })
    expect(channelSchema.parse({ ...sftpChannel, pollProblem: null })).toMatchObject({
      pollProblem: null,
    })
  })

  it('is always returned for an inbound SFTP Channel', () => {
    expect(channelSchema.safeParse({ ...sftpChannel, pollProblem: undefined }).success).toBe(false)
  })

  it('only takes a reason a Channel test can fail with', () => {
    const seeded = { ...pollProblem, reason: 'seededChannel' }

    expect(channelSchema.safeParse({ ...sftpChannel, pollProblem: seeded }).success).toBe(false)
    expect(
      channelSchema.safeParse({ ...sftpChannel, pollProblem: { ...pollProblem, since: 'today' } })
        .success,
    ).toBe(false)
  })

  it('names the address when polling was refused for a blocked address', () => {
    const blocked = {
      reason: 'addressBlocked',
      since: pollProblem.since,
      blockedAddress: 'fd00::7',
    }

    expect(channelSchema.parse({ ...sftpChannel, pollProblem: blocked })).toMatchObject({
      pollProblem: blocked,
    })
    expect(
      channelSchema.safeParse({
        ...sftpChannel,
        pollProblem: { reason: 'addressBlocked', since: pollProblem.since },
      }).success,
    ).toBe(false)
    expect(
      channelSchema.safeParse({
        ...sftpChannel,
        pollProblem: { ...pollProblem, blockedAddress: 'fd00::7' },
      }).success,
    ).toBe(false)
  })

  it('is absent on a Channel that is never polled', () => {
    expect(channelSchema.safeParse(outboundSftpChannel).success).toBe(true)
    expect(channelSchema.safeParse({ ...outboundSftpChannel, pollProblem: null }).success).toBe(
      false,
    )
    expect(channelSchema.safeParse({ ...webhookChannel, pollProblem: null }).success).toBe(false)
  })

  it('is never taken from a request', () => {
    expect(channelInputSchema.parse({ ...inboundSftp, pollProblem })).not.toHaveProperty(
      'pollProblem',
    )
    expect(channelUpdateSchema.parse({ ...inboundSftp, pollProblem })).not.toHaveProperty(
      'pollProblem',
    )
  })
})

describe('the passphrase of an SFTP private key', () => {
  const passphrase = 'open sesame'
  const lockedKey = { ...inboundSftp, authentication: 'privateKey', passphrase } as const

  it('is accepted next to a private key when creating or updating the Channel', () => {
    expect(channelInputSchema.parse(lockedKey)).toMatchObject({ passphrase })
    expect(channelUpdateSchema.parse(lockedKey)).toMatchObject({ passphrase })
    expect(channelInputSchema.parse(outboundSftp)).not.toHaveProperty('passphrase')
  })

  it('is kept when an update omits it and removed when an update sets it to null', () => {
    const withoutPassphrase = { ...lockedKey, passphrase: undefined }

    expect(channelUpdateSchema.parse(withoutPassphrase)).toMatchObject({ passphrase: undefined })
    expect(channelUpdateSchema.parse({ ...lockedKey, passphrase: null })).toMatchObject({
      passphrase: null,
    })
    expect(channelInputSchema.safeParse({ ...lockedKey, passphrase: null }).success).toBe(false)
  })

  it('rejects an empty passphrase', () => {
    expect(channelInputSchema.safeParse({ ...lockedKey, passphrase: '' }).success).toBe(false)
    expect(channelUpdateSchema.safeParse({ ...lockedKey, passphrase: '' }).success).toBe(false)
  })

  it('belongs only to a private key', () => {
    const withPassword = { ...lockedKey, authentication: 'password' }

    expect(channelInputSchema.safeParse(withPassword).success).toBe(false)
    expect(channelUpdateSchema.safeParse(withPassword).success).toBe(false)
    expect(channelUpdateSchema.safeParse({ ...withPassword, passphrase: null }).success).toBe(true)
    expect(channelInputSchema.safeParse({ ...http, passphrase }).success).toBe(true)
    expect(channelInputSchema.parse({ ...http, passphrase })).not.toHaveProperty('passphrase')
  })

  it('is read back only as stored, never with any of its characters', () => {
    const lockedChannel = {
      ...sftpChannel,
      authentication: 'privateKey',
      passphrase: { lastFour: null },
    }

    expect(channelSchema.parse(lockedChannel)).toEqual(lockedChannel)
    expect(channelSchema.parse({ ...lockedChannel, passphrase: null })).toMatchObject({
      passphrase: null,
    })
    expect(channelSchema.safeParse({ ...lockedChannel, passphrase }).success).toBe(false)
    expect(
      channelSchema.safeParse({ ...lockedChannel, passphrase: { lastFour: 'same' } }).success,
    ).toBe(false)
    expect(channelSchema.safeParse({ ...lockedChannel, authentication: 'password' }).success).toBe(
      false,
    )
  })

  it('fails a Channel test and polling with passphraseRejected when it is wrong or missing', () => {
    const testedAt = '2026-10-21T08:30:00.000Z'
    const rejected = { outcome: 'failed', reason: 'passphraseRejected', testedAt, hostKey: null }
    const pollProblem = { reason: 'passphraseRejected', since: testedAt }

    expect(channelTestResultSchema.parse(rejected)).toEqual(rejected)
    expect(channelSchema.parse({ ...sftpChannel, pollProblem })).toMatchObject({ pollProblem })
  })
})

describe('webhookAuthorization', () => {
  it('presents the webhook token as a bearer token in the Authorization header', () => {
    const webhookToken = `whk_${'Ab1'.repeat(10)}a1`

    expect({ [webhookTokenHeader]: webhookAuthorization(webhookToken) }).toEqual({
      Authorization: `Bearer ${webhookToken}`,
    })
  })
})

describe('createdChannelSchema', () => {
  it('carries the plaintext webhook token next to the masked Channel', () => {
    const webhookToken = `whk_${'Ab1'.repeat(10)}a1`

    expect(webhookTokenSchema.safeParse(webhookToken).success).toBe(true)
    expect(createdChannelSchema.parse({ channel: webhookChannel, webhookToken })).toEqual({
      channel: webhookChannel,
      webhookToken,
    })
  })
})

const fingerprint = 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8'

const otherFingerprint = 'SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU'

describe('hostKeyFingerprintSchema', () => {
  it('accepts an OpenSSH SHA256 fingerprint and trims the pasted text', () => {
    expect(hostKeyFingerprintSchema.parse(` ${fingerprint}\n`)).toBe(fingerprint)
  })

  it.each([
    'nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
    `${fingerprint}=`,
    'SHA256:short',
    'MD5:16:27:ac:a5:76:28:2d:36:63:1b:56:4d:eb:df:a6:48',
    `sha256:${fingerprint.slice(7)}`,
  ])('rejects %s', (text) => {
    expect(hostKeyFingerprintSchema.safeParse(text).success).toBe(false)
  })
})

describe('the host key fingerprint of an SFTP Channel', () => {
  it('is stored when the Admin pastes it while creating or updating the Channel', () => {
    const input = { ...inboundSftp, hostKeyFingerprint: fingerprint }

    expect(channelInputSchema.parse(input)).toMatchObject({ hostKeyFingerprint: fingerprint })
    expect(channelUpdateSchema.parse(input)).toMatchObject({ hostKeyFingerprint: fingerprint })
  })

  it('may be missing, so a Channel without one connects unchecked', () => {
    expect(channelInputSchema.safeParse(inboundSftp).success).toBe(true)
    expect(
      channelInputSchema.safeParse({ ...outboundSftp, hostKeyFingerprint: null }).success,
    ).toBe(true)
    expect(channelSchema.parse({ ...sftpChannel, hostKeyFingerprint: null })).toMatchObject({
      hostKeyFingerprint: null,
    })
  })

  it('is read back with the Channel, since it is not a secret', () => {
    const channel = { ...sftpChannel, hostKeyFingerprint: fingerprint }

    expect(channelSchema.parse(channel)).toEqual(channel)
  })

  it('rejects a malformed fingerprint', () => {
    expect(
      channelInputSchema.safeParse({ ...inboundSftp, hostKeyFingerprint: 'SHA256:short' }).success,
    ).toBe(false)
  })

  it('belongs only to SFTP Channels', () => {
    expect(
      channelSchema.safeParse({ ...webhookChannel, hostKeyFingerprint: fingerprint }).success,
    ).toBe(false)
  })
})

describe('acceptHostKeyEndpoint', () => {
  it('confirms the fingerprint a Channel test showed and returns the Channel', () => {
    expect(acceptHostKeyEndpoint.body.parse({ hostKeyFingerprint: fingerprint })).toEqual({
      hostKeyFingerprint: fingerprint,
    })
    expect(acceptHostKeyEndpoint.body.safeParse({ hostKeyFingerprint: null }).success).toBe(false)
    expect(acceptHostKeyEndpoint.response).toBe(channelSchema)
  })
})

describe('channelTestResultSchema', () => {
  const testedAt = '2026-10-20T09:00:00.000Z'

  it('shows the server fingerprint and whether it matches the confirmed one', () => {
    for (const state of ['matches', 'unchecked'] as const) {
      const result = { outcome: 'succeeded', testedAt, hostKey: { fingerprint, state } }

      expect(channelTestResultSchema.parse(result)).toEqual(result)
    }
  })

  it('fails with hostKeyMismatch and shows the fingerprint the server presented', () => {
    const result = {
      outcome: 'failed',
      reason: 'hostKeyMismatch',
      testedAt,
      hostKey: { fingerprint: otherFingerprint, state: 'mismatch' },
    }

    expect(channelTestResultSchema.parse(result)).toEqual(result)
  })

  it('has no host key for a Channel without one or a server not reached', () => {
    expect(
      channelTestResultSchema.safeParse({ outcome: 'succeeded', testedAt, hostKey: null }).success,
    ).toBe(true)
    expect(
      channelTestResultSchema.safeParse({
        outcome: 'failed',
        reason: 'hostUnreachable',
        testedAt,
        hostKey: null,
      }).success,
    ).toBe(true)
  })

  it('ties a mismatching host key to the hostKeyMismatch failure', () => {
    const mismatch = { fingerprint: otherFingerprint, state: 'mismatch' }

    expect(
      channelTestResultSchema.safeParse({ outcome: 'succeeded', testedAt, hostKey: mismatch })
        .success,
    ).toBe(false)
    expect(
      channelTestResultSchema.safeParse({
        outcome: 'failed',
        reason: 'loginRejected',
        testedAt,
        hostKey: mismatch,
      }).success,
    ).toBe(false)
    expect(
      channelTestResultSchema.safeParse({
        outcome: 'failed',
        reason: 'hostKeyMismatch',
        testedAt,
        hostKey: { fingerprint, state: 'matches' },
      }).success,
    ).toBe(false)
  })

  it('names the address when a Channel points at a blocked address', () => {
    const blocked = {
      outcome: 'failed',
      reason: 'addressBlocked',
      testedAt,
      blockedAddress: '10.0.4.17',
    }

    expect(channelTestResultSchema.parse(blocked)).toEqual(blocked)
    expect(
      channelTestResultSchema.safeParse({ ...blocked, blockedAddress: '::ffff:127.0.0.1' }).success,
    ).toBe(true)
    expect(
      channelTestResultSchema.safeParse({ ...blocked, blockedAddress: 'sftp.internal' }).success,
    ).toBe(false)
  })

  it('carries a blocked address exactly when the address was blocked', () => {
    expect(
      channelTestResultSchema.safeParse({ outcome: 'failed', reason: 'addressBlocked', testedAt })
        .success,
    ).toBe(false)
    expect(
      channelTestResultSchema.safeParse({
        outcome: 'failed',
        reason: 'hostUnreachable',
        testedAt,
        blockedAddress: '10.0.4.17',
      }).success,
    ).toBe(false)
  })
})
