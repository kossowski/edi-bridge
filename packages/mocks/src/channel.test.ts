import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  channelEndpoint,
  type ChannelInput,
  type ChannelUpdate,
  channelsEndpoint,
  createChannelEndpoint,
  regenerateWebhookTokenEndpoint,
  toPath,
  updateChannelEndpoint,
} from '@edi-bridge/contracts'

import {
  channelHandlers,
  type ChannelRecord,
  createChannel,
  createChannels,
  createChannelStore,
  seedChannels,
  toChannel,
} from './channel'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function send(method: string, path: string, body?: Partial<ChannelInput> | ChannelUpdate) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

async function listChannels() {
  const response = await send('GET', channelsEndpoint.path)

  return channelsEndpoint.response.parse(await response.json())
}

function secretsOf(record: ChannelRecord): string[] {
  switch (record.type) {
    case 'sftp':
      return [record.credential]
    case 'webhook':
      return [record.token]
    case 'http':
      return record.authorization === null ? [] : [record.authorization]
  }
}

type InboundSftpInput = Extract<ChannelInput, { type: 'sftp'; direction: 'inbound' }>

type HttpInput = Extract<ChannelInput, { type: 'http' }>

const sftpInputWithoutPollingInterval: Omit<InboundSftpInput, 'pollingIntervalMinutes'> = {
  type: 'sftp',
  direction: 'inbound',
  name: 'Mainfranken SFTP inbox',
  tradingPartnerId: null,
  host: 'sftp.mainfranken.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  credential: 'first-password',
}

const sftpInput: InboundSftpInput = {
  ...sftpInputWithoutPollingInterval,
  pollingIntervalMinutes: 15,
}

const webhookInput: ChannelInput = {
  type: 'webhook',
  direction: 'inbound',
  name: 'Shop webhook',
  tradingPartnerId: null,
  rateLimitPerMinute: 60,
}

const httpInput: HttpInput = {
  type: 'http',
  direction: 'outbound',
  name: 'Shop HTTP delivery',
  tradingPartnerId: null,
  url: 'https://shop.example/edi',
  authorization: 'Bearer first',
}

describe('seed Channels', () => {
  it('cover all four Channel types', () => {
    expect(new Set(seedChannels.map(({ type, direction }) => `${direction} ${type}`))).toEqual(
      new Set(['inbound sftp', 'outbound sftp', 'inbound webhook', 'outbound http']),
    )
  })
})

describe('toChannel', () => {
  const webhook = createChannel({ type: 'webhook', direction: 'inbound' })

  afterEach(() => vi.unstubAllGlobals())

  it('resolves a relative API URL against the page origin', () => {
    vi.stubGlobal('location', new URL('https://edi.nordwind.example/runs'))

    expect(toChannel(webhook, '/api')).toMatchObject({
      url: `https://edi.nordwind.example/api/webhooks/${webhook.id}`,
    })
  })

  it('resolves a relative API URL outside the browser', () => {
    expect(toChannel(webhook, '/api')).toMatchObject({
      url: `http://localhost/api/webhooks/${webhook.id}`,
    })
  })
})

describe('createChannels', () => {
  it('spreads the Channels over the seed Trading Partners and some without one', () => {
    const tradingPartnerIds = createChannels({ count: 200 }).map(
      ({ tradingPartnerId }) => tradingPartnerId,
    )

    expect(new Set(tradingPartnerIds)).toEqual(
      new Set([null, ...seedTradingPartners.map(({ id }) => id)]),
    )
  })

  it('generates the same Channels for the same seed', () => {
    expect(createChannels({ count: 5 })).toEqual(createChannels({ count: 5 }))
  })
})

describe('channelHandlers', () => {
  it('lists the seed Channels sorted by name without any plaintext secret', async () => {
    server.use(...channelHandlers(apiUrl))
    const response = await send('GET', channelsEndpoint.path)
    const text = await response.text()
    const channels = channelsEndpoint.response.parse(JSON.parse(text))

    expect(channels.map(({ id }) => id).sort()).toEqual(seedChannels.map(({ id }) => id).sort())
    expect(channels.map(({ name }) => name)).toEqual(
      channels.map(({ name }) => name).sort((a, b) => a.localeCompare(b, 'de')),
    )

    for (const secret of seedChannels.flatMap(secretsOf)) {
      expect(text).not.toContain(secret)
    }
  })

  it('serves an empty list', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    expect(await listChannels()).toEqual([])
  })

  it('serves a large volume of generated Channels', async () => {
    const channels = createChannels({ count: 500 })

    server.use(...channelHandlers(apiUrl, { channels }))

    const listed = await listChannels()

    expect(listed).toHaveLength(500)
    expect(new Set(listed.map(({ type }) => type))).toEqual(new Set(['sftp', 'webhook', 'http']))
  })

  it('serves one Channel and 404 for an unknown one', async () => {
    const [channel] = seedChannels
    server.use(...channelHandlers(apiUrl))

    const found = await send('GET', toPath(channelEndpoint.path, { id: channel!.id }))
    const missing = await send('GET', toPath(channelEndpoint.path, { id: crypto.randomUUID() }))

    expect(channelEndpoint.response.parse(await found.json()).id).toBe(channel!.id)
    expect(missing.status).toBe(404)
  })

  it('creates a webhook Channel and reveals its token only in the create response', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const response = await send('POST', createChannelEndpoint.path, webhookInput)
    const { channel, webhookToken } = createChannelEndpoint.response.parse(await response.json())

    expect(response.status).toBe(201)
    expect(webhookToken).not.toBeNull()
    expect(channel).toMatchObject({
      type: 'webhook',
      url: `${apiUrl}/webhooks/${channel.id}`,
      token: { lastFour: webhookToken!.slice(-4) },
    })

    const detail = await send('GET', toPath(channelEndpoint.path, channel))

    expect(await detail.text()).not.toContain(webhookToken)
  })

  it('creates an SFTP Channel with a hidden credential and no webhook token', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const response = await send('POST', createChannelEndpoint.path, sftpInput)
    const text = await response.text()
    const { channel, webhookToken } = createChannelEndpoint.response.parse(JSON.parse(text))

    expect(webhookToken).toBeNull()
    expect(channel).toMatchObject({ type: 'sftp', credential: { lastFour: null } })
    expect(text).not.toContain('first-password')
    expect(await listChannels()).toEqual([channel])
  })

  it('polls a new SFTP Channel every minute when no interval is given', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))
    const response = await send('POST', createChannelEndpoint.path, sftpInputWithoutPollingInterval)

    expect(createChannelEndpoint.response.parse(await response.json()).channel).toMatchObject({
      pollingIntervalMinutes: 1,
    })
  })

  it('rejects an invalid Channel', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const response = await send('POST', createChannelEndpoint.path, { ...sftpInput, port: 0 })

    expect(response.status).toBe(400)
  })

  it('keeps an omitted secret and replaces a given one on update', async () => {
    const existing: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    const store = createChannelStore([existing])
    server.use(...channelHandlers(apiUrl, { channels: store }))
    const path = toPath(updateChannelEndpoint.path, existing)
    const update = { ...sftpInput, name: 'Renamed SFTP inbox', credential: undefined }

    const kept = await send('PUT', path, update)

    expect(updateChannelEndpoint.response.parse(await kept.json()).name).toBe('Renamed SFTP inbox')
    expect(store.get(existing.id)).toMatchObject({ credential: 'first-password' })

    await send('PUT', path, { ...update, credential: 'second-password' })

    expect(store.get(existing.id)).toMatchObject({ credential: 'second-password' })
  })

  it('requires a new credential when the SFTP authentication method changes', async () => {
    const existing: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))
    const withoutCredential = { ...sftpInput, credential: undefined }

    const response = await send('PUT', toPath(updateChannelEndpoint.path, existing), {
      ...withoutCredential,
      authentication: 'privateKey',
    })

    expect(response.status).toBe(400)
  })

  it('removes the HTTP Authorization header on update with null', async () => {
    const existing: ChannelRecord = { ...httpInput, id: crypto.randomUUID() }
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))
    const path = toPath(updateChannelEndpoint.path, existing)
    const withoutAuthorization = { ...httpInput, authorization: undefined }

    const kept = await send('PUT', path, withoutAuthorization)
    const removed = await send('PUT', path, { ...httpInput, authorization: null })

    expect(updateChannelEndpoint.response.parse(await kept.json())).toMatchObject({
      authorization: { lastFour: null },
    })
    expect(updateChannelEndpoint.response.parse(await removed.json())).toMatchObject({
      authorization: null,
    })
  })

  it('refuses to change the type or direction of a Channel', async () => {
    const existing = createChannel({ type: 'sftp', direction: 'outbound' })
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))

    const response = await send('PUT', toPath(updateChannelEndpoint.path, existing), sftpInput)

    expect(response.status).toBe(409)
  })

  it('answers 404 when updating an unknown Channel', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const response = await send(
      'PUT',
      toPath(updateChannelEndpoint.path, { id: crypto.randomUUID() }),
      sftpInput,
    )

    expect(response.status).toBe(404)
  })

  it('regenerates the webhook token and invalidates the old one', async () => {
    const existing = createChannel({ type: 'webhook', direction: 'inbound' })
    const store = createChannelStore([existing])
    server.use(...channelHandlers(apiUrl, { channels: store }))

    const response = await send('POST', toPath(regenerateWebhookTokenEndpoint.path, existing))

    const { channel, webhookToken } = regenerateWebhookTokenEndpoint.response.parse(
      await response.json(),
    )

    expect(existing.type === 'webhook' && existing.token).not.toBe(webhookToken)
    expect(store.get(existing.id)).toMatchObject({ token: webhookToken })
    expect(channel).toMatchObject({ token: { lastFour: webhookToken.slice(-4) } })
  })

  it('refuses to regenerate a token for a Channel that is not a webhook', async () => {
    const existing = createChannel({ type: 'http', direction: 'outbound' })
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))

    const response = await send('POST', toPath(regenerateWebhookTokenEndpoint.path, existing))

    expect(response.status).toBe(409)
  })
})
