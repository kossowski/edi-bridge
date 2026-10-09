import { describe, expect, it } from 'vitest'

import {
  type Channel,
  type ChannelInput,
  channelInputSchema,
  channelKinds,
  channelSchema,
  channelSummarySchema,
  channelUpdateSchema,
  createdChannelSchema,
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
