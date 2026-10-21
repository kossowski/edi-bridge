import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import { secretBox, secretContext, type SecretColumn } from '@edi-bridge/channels'
import {
  acceptHostKeyEndpoint,
  type ChannelInput,
  channelEndpoint,
  channelsEndpoint,
  createChannelEndpoint,
  createdChannelSchema,
  regeneratedWebhookTokenSchema,
  regenerateWebhookTokenEndpoint,
  updateChannelEndpoint,
} from '@edi-bridge/contracts'
import { channels, tradingPartners } from '@edi-bridge/db'

import {
  type Client,
  otherWorkspace,
  ownWorkspace,
  startTestApi,
  type TestApi,
  testChannels,
} from './testing.js'

type Body = NonNullable<InjectOptions['body']>

const webhook: ChannelInput = {
  type: 'webhook',
  direction: 'inbound',
  name: 'ERP webhook',
  tradingPartnerId: null,
  rateLimitPerMinute: 60,
}

const httpSettings = {
  type: 'http',
  direction: 'outbound',
  name: 'ERP HTTP delivery',
  tradingPartnerId: null,
  url: 'https://erp.nordwind-handel.example/api/edi/documents',
} as const

const httpDelivery: ChannelInput = { ...httpSettings, authorization: 'Bearer erp-api-key-0815' }

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const sftpSettings = {
  type: 'sftp',
  direction: 'inbound',
  name: 'Hansemarkt SFTP inbox',
  tradingPartnerId: null,
  host: 'sftp.hansemarkt.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  pollingIntervalMinutes: 5,
} as const

const sftpInbox: ChannelInput = { ...sftpSettings, credential: 'sftp-password-4711' }

const hostKeyFingerprint = 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s'

const otherHostKeyFingerprint = 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM'

let api: TestApi

let admin: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ admin, otherAdmin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await api.connection.db.delete(channels)
  await api.connection.db.delete(tradingPartners)
})

const post = (body: Body, target = admin) =>
  target.inject({ method: 'POST', url: createChannelEndpoint.path, body })

const created = async (body: ChannelInput, target = admin) => {
  const response = await post(body, target)

  expect(response.statusCode).toBe(201)

  return createdChannelSchema.parse(response.json())
}

const get = (id: string, target = admin) =>
  target.inject({ method: 'GET', url: channelEndpoint.path.replace(':id', id) })

const update = (id: string, body: Body, target = admin) =>
  target.inject({ method: 'PUT', url: updateChannelEndpoint.path.replace(':id', id), body })

const list = (target = admin) => target.inject({ method: 'GET', url: channelsEndpoint.path })

const accept = (id: string, body: Body, target = admin) =>
  target.inject({ method: 'PUT', url: acceptHostKeyEndpoint.path.replace(':id', id), body })

describe('POST /channels', () => {
  it('stores an inbound SFTP Channel and returns its credential masked', async () => {
    const { channel, webhookToken } = await created(sftpInbox)

    expect(channel).toEqual({
      ...sftpSettings,
      id: channel.id,
      credential: { lastFour: null },
      hostKeyFingerprint: null,
      pollProblem: null,
    })
    expect(webhookToken).toBeNull()

    const response = await get(channel.id)

    expect(response.statusCode).toBe(200)
    expect(channelEndpoint.response.parse(response.json())).toEqual(channel)
    expect(channelsEndpoint.response.parse((await list()).json())).toEqual([channel])
  })
})

const storedRow = async (id: string) => {
  const [row] = await api.connection.db.select().from(channels).where(eq(channels.id, id))

  if (!row) {
    throw new Error(`Channel ${id} is not stored`)
  }

  return row
}

const opened = (id: string, column: SecretColumn, sealed: string | null) =>
  sealed === null ? null : secretBox(testChannels.secretKey).open(sealed, secretContext(id, column))

describe('stored secrets', () => {
  it('are encrypted in Postgres and decrypt with the configured key', async () => {
    const sftp = await created(sftpInbox)
    const http = await created(httpDelivery)
    const hook = await created(webhook)

    const sftpRow = await storedRow(sftp.channel.id)
    const httpRow = await storedRow(http.channel.id)
    const hookRow = await storedRow(hook.channel.id)

    expect(JSON.stringify([sftpRow, httpRow, hookRow])).not.toMatch(
      /sftp-password-4711|erp-api-key-0815|whk_/,
    )
    expect(opened(sftp.channel.id, 'encryptedCredential', sftpRow.encryptedCredential)).toBe(
      'sftp-password-4711',
    )
    expect(opened(http.channel.id, 'encryptedAuthorization', httpRow.encryptedAuthorization)).toBe(
      'Bearer erp-api-key-0815',
    )
    expect(opened(hook.channel.id, 'encryptedWebhookToken', hookRow.encryptedWebhookToken)).toBe(
      hook.webhookToken,
    )
  })

  it('do not decrypt for another Channel', async () => {
    const first = await created(sftpInbox)
    const second = await created(sftpInbox)
    const { encryptedCredential } = await storedRow(first.channel.id)

    expect(() => opened(second.channel.id, 'encryptedCredential', encryptedCredential)).toThrow()
  })

  it('never leave the API in a list or get response', async () => {
    const { channel } = await created(httpDelivery)
    await created(sftpInbox)
    await created(webhook)

    const bodies = [(await list()).body, (await get(channel.id)).body].join('\n')

    expect(bodies).not.toMatch(/sftp-password-4711|erp-api-key-0815|whk_/)
  })
})

describe('a webhook Channel', () => {
  it('gets a generated token that the create response returns once', async () => {
    const { channel, webhookToken } = await created(webhook)

    expect(webhookToken).toMatch(/^whk_[A-Za-z0-9]{32}$/)
    expect(channel).toEqual({
      ...webhook,
      id: channel.id,
      url: `http://localhost:3001/webhooks/${channel.id}`,
      token: { lastFour: webhookToken?.slice(-4) },
    })
  })

  it('gets a different token each time', async () => {
    const first = await created(webhook)
    const second = await created(webhook)

    expect(first.webhookToken).not.toBe(second.webhookToken)
  })
})

describe('an outbound HTTP Channel', () => {
  it('shows only that an Authorization header is set', async () => {
    const { channel } = await created(httpDelivery)

    expect(channel).toEqual({ ...httpDelivery, id: channel.id, authorization: { lastFour: null } })
  })

  it('may have no Authorization header', async () => {
    const { channel } = await created({ ...httpDelivery, authorization: null })

    expect(channel).toMatchObject({ authorization: null })
  })
})

describe('an outbound SFTP Channel', () => {
  it('has no polling interval', async () => {
    const { channel } = await created({
      type: 'sftp',
      direction: 'outbound',
      name: 'Hansemarkt SFTP outbox',
      tradingPartnerId: null,
      host: 'sftp.hansemarkt.example',
      port: 22,
      username: 'nordwind',
      remotePath: '/inbox',
      authentication: 'password',
      credential: 'sftp-password-4711',
    })

    expect(channel).not.toHaveProperty('pollingIntervalMinutes')
    expect(channel).not.toHaveProperty('pollProblem')
    expect(channel).toMatchObject({ direction: 'outbound', remotePath: '/inbox' })
  })
})

describe('the poll problem of an inbound SFTP Channel', () => {
  it('is returned with the time of its first failure in the Channel and the Channel list', async () => {
    const { channel } = await created(sftpInbox)

    await api.connection.db
      .update(channels)
      .set({
        pollProblemReason: 'hostKeyMismatch',
        pollProblemSince: new Date('2026-10-20T07:15:00.000Z'),
      })
      .where(eq(channels.id, channel.id))

    const pollProblem = { reason: 'hostKeyMismatch', since: '2026-10-20T07:15:00.000Z' }

    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toMatchObject({
      pollProblem,
    })
    expect(channelsEndpoint.response.parse((await list()).json())).toMatchObject([{ pollProblem }])
  })

  it('names the blocked address of a Channel at an internal address', async () => {
    const { channel } = await created(sftpInbox)

    await api.connection.db
      .update(channels)
      .set({
        pollProblemReason: 'addressBlocked',
        pollProblemSince: new Date('2026-10-20T07:15:00.000Z'),
        pollProblemBlockedAddress: '10.0.4.17',
      })
      .where(eq(channels.id, channel.id))

    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toMatchObject({
      pollProblem: {
        reason: 'addressBlocked',
        since: '2026-10-20T07:15:00.000Z',
        blockedAddress: '10.0.4.17',
      },
    })
  })
})

describe('the host key fingerprint of an SFTP Channel', () => {
  it('is stored when the Admin pastes it into a new Channel', async () => {
    const { channel } = await created({ ...sftpInbox, hostKeyFingerprint })

    expect(channel).toMatchObject({ hostKeyFingerprint })
    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toMatchObject({
      hostKeyFingerprint,
    })
  })

  it('is kept when an update leaves it out and removed when an update sends null', async () => {
    const { channel } = await created({ ...sftpInbox, hostKeyFingerprint })

    const kept = await update(channel.id, { ...sftpSettings, name: 'Hansemarkt outbox' })

    expect(channelEndpoint.response.parse(kept.json())).toMatchObject({ hostKeyFingerprint })

    const replaced = await update(channel.id, {
      ...sftpSettings,
      hostKeyFingerprint: otherHostKeyFingerprint,
    })

    expect(channelEndpoint.response.parse(replaced.json())).toMatchObject({
      hostKeyFingerprint: otherHostKeyFingerprint,
    })

    const removed = await update(channel.id, { ...sftpSettings, hostKeyFingerprint: null })

    expect(channelEndpoint.response.parse(removed.json())).toMatchObject({
      hostKeyFingerprint: null,
    })
  })

  it('answers 400 for a fingerprint that is not an OpenSSH SHA256 fingerprint', async () => {
    const response = await post({ ...sftpInbox, hostKeyFingerprint: 'MD5:16:27:ac:a5:76:28' })

    expect(response.statusCode).toBe(400)
  })
})

describe('PUT /channels/:id/host-key', () => {
  it('stores the fingerprint the Admin accepted and returns the Channel', async () => {
    const { channel } = await created(sftpInbox)

    const response = await accept(channel.id, { hostKeyFingerprint })

    expect(response.statusCode).toBe(200)
    expect(acceptHostKeyEndpoint.response.parse(response.json())).toEqual({
      ...channel,
      hostKeyFingerprint,
    })
    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toMatchObject({
      hostKeyFingerprint,
    })
  })

  it('answers 409 for a Channel that has no host key', async () => {
    const { channel } = await created(httpDelivery)

    const response = await accept(channel.id, { hostKeyFingerprint })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ message: 'Only SFTP Channels have a host key' })
  })

  it("answers 400 for an invalid fingerprint and 404 for another Workspace's Channel", async () => {
    const { channel } = await created(sftpInbox)
    const { channel: foreign } = await created(sftpInbox, otherAdmin)

    expect((await accept(channel.id, { hostKeyFingerprint: 'SHA256:short' })).statusCode).toBe(400)
    expect((await accept(foreign.id, { hostKeyFingerprint })).statusCode).toBe(404)
    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toMatchObject({
      hostKeyFingerprint: null,
    })
  })
})

const addTradingPartner = async (workspaceId: string) => {
  const [row] = await api.connection.db
    .insert(tradingPartners)
    .values({
      workspaceId,
      name: 'Hansemarkt GmbH',
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: 24,
    })
    .returning({ id: tradingPartners.id })

  if (!row) {
    throw new Error('The Trading Partner is not stored')
  }

  return row.id
}

describe('the Trading Partner of a Channel', () => {
  it('is stored when it belongs to the Workspace', async () => {
    const tradingPartnerId = await addTradingPartner(ownWorkspace.id)

    const { channel } = await created({ ...sftpInbox, tradingPartnerId })

    expect(channel.tradingPartnerId).toBe(tradingPartnerId)
  })

  it.each([
    ['an unknown', () => unknownId],
    ["another Workspace's", () => addTradingPartner(otherWorkspace.id)],
  ])('answers 422 for %s Trading Partner', async (_case, tradingPartnerId) => {
    const response = await post({ ...sftpInbox, tradingPartnerId: await tradingPartnerId() })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'Unknown Trading Partner' })
    expect(channelsEndpoint.response.parse((await list()).json())).toEqual([])
  })
})

describe('a Channel request', () => {
  it.each([
    ['without a credential', { ...sftpInbox, credential: undefined }],
    ['with an unknown kind', { ...webhook, direction: 'outbound' }],
    ['with a relative remote path', { ...sftpInbox, remotePath: 'outbox' }],
  ])('answers 400 %s', async (_case, body) => {
    const response = await post(body)

    expect(response.statusCode).toBe(400)
  })
})

describe('the Channels of another Workspace', () => {
  it('are neither listed nor found', async () => {
    const { channel } = await created(sftpInbox, otherAdmin)

    expect(channelsEndpoint.response.parse((await list()).json())).toEqual([])
    expect((await get(channel.id)).statusCode).toBe(404)
  })

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await get(unknownId)).statusCode).toBe(404)
    expect((await get('not-a-uuid')).statusCode).toBe(404)
  })
})

describe('PUT /channels/:id', () => {
  it('changes the settings and keeps the stored credential when none is sent', async () => {
    const { channel } = await created(sftpInbox)

    const changes = {
      ...sftpSettings,
      host: 'sftp2.hansemarkt.example',
      pollingIntervalMinutes: 15,
    }

    const response = await update(channel.id, changes)

    expect(response.statusCode).toBe(200)
    expect(channelEndpoint.response.parse(response.json())).toEqual({
      ...changes,
      id: channel.id,
      credential: { lastFour: null },
      hostKeyFingerprint: null,
      pollProblem: null,
    })
    expect(channelEndpoint.response.parse((await get(channel.id)).json())).toEqual(response.json())

    const { encryptedCredential } = await storedRow(channel.id)

    expect(opened(channel.id, 'encryptedCredential', encryptedCredential)).toBe(
      'sftp-password-4711',
    )
  })

  it('replaces the credential when a new one is sent', async () => {
    const { channel } = await created(sftpInbox)

    const response = await update(channel.id, {
      ...sftpInbox,
      authentication: 'privateKey',
      credential: 'private-key-pem',
    })

    expect(response.statusCode).toBe(200)

    const { encryptedCredential } = await storedRow(channel.id)

    expect(opened(channel.id, 'encryptedCredential', encryptedCredential)).toBe('private-key-pem')
  })

  it('answers 422 when the authentication method changes without a new credential', async () => {
    const { channel } = await created(sftpInbox)
    const response = await update(channel.id, { ...sftpSettings, authentication: 'privateKey' })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'A new credential is required when the authentication method changes',
    })
  })

  it.each([
    ['keeps', {}, 'Bearer erp-api-key-0815'],
    ['replaces', { authorization: 'Bearer new-key' }, 'Bearer new-key'],
    ['removes', { authorization: null }, null],
  ])('%s the Authorization header of an HTTP Channel', async (_case, change, expected) => {
    const { channel } = await created(httpDelivery)
    const response = await update(channel.id, { ...httpSettings, ...change })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      authorization: expected === null ? null : { lastFour: null },
    })

    const { encryptedAuthorization } = await storedRow(channel.id)

    expect(opened(channel.id, 'encryptedAuthorization', encryptedAuthorization)).toBe(expected)
  })

  it('keeps the token of a webhook Channel', async () => {
    const { channel, webhookToken } = await created(webhook)

    const response = await update(channel.id, { ...webhook, rateLimitPerMinute: 120 })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...channel, rateLimitPerMinute: 120 })

    const { encryptedWebhookToken } = await storedRow(channel.id)

    expect(opened(channel.id, 'encryptedWebhookToken', encryptedWebhookToken)).toBe(webhookToken)
  })

  it('answers 409 when the type or direction changes', async () => {
    const { channel } = await created(sftpInbox)

    const response = await update(channel.id, httpDelivery)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      message: 'The type and direction of a Channel cannot change',
    })
  })

  it('answers 422 for an unknown Trading Partner', async () => {
    const { channel } = await created(sftpInbox)

    const response = await update(channel.id, { ...sftpInbox, tradingPartnerId: unknownId })

    expect(response.statusCode).toBe(422)
  })

  it("answers 400 for an invalid body and 404 for another Workspace's Channel", async () => {
    const { channel } = await created(sftpInbox)
    const { channel: foreign } = await created(sftpInbox, otherAdmin)

    expect((await update(channel.id, { ...sftpInbox, port: 0 })).statusCode).toBe(400)
    expect((await update(foreign.id, sftpInbox)).statusCode).toBe(404)
    expect((await update(unknownId, sftpInbox)).statusCode).toBe(404)
  })
})

const regenerate = (id: string, target = admin) =>
  target.inject({
    method: 'POST',
    url: regenerateWebhookTokenEndpoint.path.replace(':id', id),
  })

describe('POST /channels/:id/webhook-token', () => {
  it('replaces the token and returns the new one once', async () => {
    const { channel, webhookToken } = await created(webhook)

    const response = await regenerate(channel.id)

    expect(response.statusCode).toBe(200)

    const regenerated = regeneratedWebhookTokenSchema.parse(response.json())

    expect(regenerated.webhookToken).not.toBe(webhookToken)
    expect(regenerated.channel).toEqual({
      ...channel,
      token: { lastFour: regenerated.webhookToken.slice(-4) },
    })

    const { encryptedWebhookToken } = await storedRow(channel.id)

    expect(opened(channel.id, 'encryptedWebhookToken', encryptedWebhookToken)).toBe(
      regenerated.webhookToken,
    )
  })

  it('answers 409 for a Channel without a token', async () => {
    const { channel } = await created(sftpInbox)

    const response = await regenerate(channel.id)

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ message: 'Only webhook Channels have a token' })
  })

  it("answers 404 for another Workspace's Channel", async () => {
    const { channel } = await created(webhook, otherAdmin)

    expect((await regenerate(channel.id)).statusCode).toBe(404)
  })
})
