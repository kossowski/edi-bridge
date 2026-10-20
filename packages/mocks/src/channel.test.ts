import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  acceptHostKeyEndpoint,
  channelEndpoint,
  type ChannelInput,
  type ChannelUpdate,
  channelsEndpoint,
  createChannelEndpoint,
  regenerateWebhookTokenEndpoint,
  testChannelEndpoint,
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
  seedConnectionFailures,
  toChannel,
} from './channel'
import { seedFlows } from './flow'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

const anyFingerprint: unknown = expect.stringMatching(/^SHA256:/)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})

afterAll(() => server.close())

async function send(
  method: string,
  path: string,
  body?: Partial<ChannelInput> | ChannelUpdate | { hostKeyFingerprint: string | null },
) {
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

    expect(response.status).toBe(422)
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

  it('refuses to change the Trading Partner of a Channel a Flow uses', async () => {
    const [flow] = seedFlows
    const used = seedChannels.find(({ id }) => id === flow?.inboundChannelId)
    const other = seedTradingPartners.find(({ id }) => id !== used?.tradingPartnerId)

    if (!used || !other) {
      throw new Error('The seed has no Channel a Flow uses')
    }

    const store = createChannelStore()
    server.use(...channelHandlers(apiUrl, { channels: store, flows: seedFlows }))
    const path = toPath(updateChannelEndpoint.path, used)

    const moved = await send('PUT', path, { ...used, tradingPartnerId: other.id })
    const renamed = await send('PUT', path, { ...used, name: 'Renamed inbox' })

    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({
      message: 'The Trading Partner of a Channel cannot change while a Flow uses it',
    })
    expect(renamed.status).toBe(200)
    expect(store.get(used.id)).toMatchObject({
      tradingPartnerId: used.tradingPartnerId,
      name: 'Renamed inbox',
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

describe('POST /channels/:id/test', () => {
  async function testChannel(id: string) {
    const response = await send('POST', toPath(testChannelEndpoint.path, { id }))

    const body: unknown = await response.json()

    return { status: response.status, body }
  }

  it('reaches a working Channel', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    const existing = createChannel({ type: 'sftp', direction: 'outbound' })
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))

    const { body } = await testChannel(existing.id)

    expect(testChannelEndpoint.response.parse(body)).toEqual({
      outcome: 'succeeded',
      testedAt: '2026-10-10T12:00:00.000Z',
      hostKey: { fingerprint: anyFingerprint, state: 'unchecked' },
    })
  })

  it('names the reason a Channel cannot be reached until its settings are updated', async () => {
    const existing: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }

    server.use(
      ...channelHandlers(apiUrl, {
        channels: [existing],
        connectionFailures: new Map([[existing.id, 'loginRejected']]),
      }),
    )

    expect(testChannelEndpoint.response.parse((await testChannel(existing.id)).body)).toMatchObject(
      { outcome: 'failed', reason: 'loginRejected' },
    )

    await send('PUT', toPath(updateChannelEndpoint.path, existing), {
      ...sftpInput,
      credential: 'new-password',
    })

    expect(testChannelEndpoint.response.parse((await testChannel(existing.id)).body)).toMatchObject(
      { outcome: 'succeeded' },
    )
  })

  it('seeds a rejected login on an outbound SFTP Channel of a Trading Partner', async () => {
    server.use(...channelHandlers(apiUrl))
    const [id, reason] = [...seedConnectionFailures][0]!
    const channel = seedChannels.find((record) => record.id === id)

    expect(channel).toMatchObject({ type: 'sftp', direction: 'outbound' })
    expect(channel?.tradingPartnerId).not.toBeNull()
    expect(reason).toBe('loginRejected')

    expect(testChannelEndpoint.response.parse((await testChannel(id)).body)).toMatchObject({
      outcome: 'failed',
      reason: 'loginRejected',
    })
  })

  it('answers 404 for an unknown Channel', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    expect((await testChannel(crypto.randomUUID())).status).toBe(404)
  })
})

describe('the host key of an SFTP Channel', () => {
  const otherKey = 'SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU'

  async function testChannel(id: string) {
    const response = await send('POST', toPath(testChannelEndpoint.path, { id }))

    return testChannelEndpoint.response.parse(await response.json())
  }

  async function accept(id: string, hostKeyFingerprint: string | null) {
    return send('PUT', toPath(acceptHostKeyEndpoint.path, { id }), { hostKeyFingerprint })
  }

  it('serves null as the key of an SFTP Channel without one, as the API does', () => {
    expect(toChannel({ ...sftpInput, id: crypto.randomUUID() }, apiUrl)).toHaveProperty(
      'hostKeyFingerprint',
      null,
    )
  })

  it('shows the server key of a Channel without one as unchecked', async () => {
    const existing: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))

    const result = await testChannel(existing.id)

    expect(result).toMatchObject({
      outcome: 'succeeded',
      hostKey: { fingerprint: anyFingerprint, state: 'unchecked' },
    })
  })

  it('shows the same server key on every test of the same host', async () => {
    const first: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    const second: ChannelRecord = { ...sftpInput, id: crypto.randomUUID(), direction: 'outbound' }

    const elsewhere: ChannelRecord = {
      ...sftpInput,
      id: crypto.randomUUID(),
      host: 'sftp.b.example',
    }

    server.use(...channelHandlers(apiUrl, { channels: [first, second, elsewhere] }))

    const key = (await testChannel(first.id)).hostKey?.fingerprint

    expect((await testChannel(first.id)).hostKey?.fingerprint).toBe(key)
    expect((await testChannel(second.id)).hostKey?.fingerprint).toBe(key)
    expect((await testChannel(elsewhere.id)).hostKey?.fingerprint).not.toBe(key)
  })

  it('matches once the Admin accepts the key the test showed', async () => {
    const existing: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    server.use(...channelHandlers(apiUrl, { channels: [existing] }))
    const shown = (await testChannel(existing.id)).hostKey!.fingerprint

    const response = await accept(existing.id, shown)

    expect(response.status).toBe(200)
    expect(acceptHostKeyEndpoint.response.parse(await response.json())).toMatchObject({
      id: existing.id,
      hostKeyFingerprint: shown,
    })
    expect(await testChannel(existing.id)).toMatchObject({
      outcome: 'succeeded',
      hostKey: { fingerprint: shown, state: 'matches' },
    })
  })

  it('refuses a server whose key differs from the confirmed one', async () => {
    const existing: ChannelRecord = {
      ...sftpInput,
      id: crypto.randomUUID(),
      hostKeyFingerprint: otherKey,
    }

    server.use(...channelHandlers(apiUrl, { channels: [existing] }))

    const result = await testChannel(existing.id)

    expect(result).toMatchObject({
      outcome: 'failed',
      reason: 'hostKeyMismatch',
      hostKey: { state: 'mismatch' },
    })
    expect(result.hostKey?.fingerprint).not.toBe(otherKey)
  })

  it('refuses a mismatching server before it reaches the login', async () => {
    const existing: ChannelRecord = {
      ...sftpInput,
      id: crypto.randomUUID(),
      hostKeyFingerprint: otherKey,
    }

    server.use(
      ...channelHandlers(apiUrl, {
        channels: [existing],
        connectionFailures: new Map([[existing.id, 'loginRejected']]),
      }),
    )

    expect(await testChannel(existing.id)).toMatchObject({ reason: 'hostKeyMismatch' })
  })

  it('shows no key for a server it did not reach or a Channel without SFTP', async () => {
    const unreachable: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    const http: ChannelRecord = { ...httpInput, id: crypto.randomUUID() }
    server.use(
      ...channelHandlers(apiUrl, {
        channels: [unreachable, http],
        connectionFailures: new Map([[unreachable.id, 'hostUnreachable']]),
      }),
    )

    expect(await testChannel(unreachable.id)).toMatchObject({
      reason: 'hostUnreachable',
      hostKey: null,
    })
    expect(await testChannel(http.id)).toMatchObject({ outcome: 'succeeded', hostKey: null })
  })

  it('stores a pasted key, keeps it when omitted and removes it with null', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const created = createChannelEndpoint.response.parse(
      await (
        await send('POST', createChannelEndpoint.path, {
          ...sftpInput,
          hostKeyFingerprint: otherKey,
        })
      ).json(),
    ).channel

    const path = toPath(updateChannelEndpoint.path, created)

    expect(created).toMatchObject({ hostKeyFingerprint: otherKey })
    expect(await (await send('PUT', path, { ...sftpInput, name: 'Renamed' })).json()).toMatchObject(
      { name: 'Renamed', hostKeyFingerprint: otherKey },
    )
    expect(
      await (await send('PUT', path, { ...sftpInput, hostKeyFingerprint: null })).json(),
    ).toMatchObject({ hostKeyFingerprint: null })
  })

  it('answers 404, 409 and 400 for an unknown Channel, one without SFTP and a malformed key', async () => {
    const http: ChannelRecord = { ...httpInput, id: crypto.randomUUID() }
    const sftp: ChannelRecord = { ...sftpInput, id: crypto.randomUUID() }
    server.use(...channelHandlers(apiUrl, { channels: [http, sftp] }))

    expect((await accept(crypto.randomUUID(), otherKey)).status).toBe(404)
    expect((await accept(http.id, otherKey)).status).toBe(409)
    expect((await accept(sftp.id, 'SHA256:short')).status).toBe(400)
    expect((await accept(sftp.id, null)).status).toBe(400)
  })

  it('seeds confirmed, unchecked and mismatching keys', async () => {
    server.use(...channelHandlers(apiUrl))
    const states = new Set<string | undefined>()

    for (const channel of seedChannels.filter(({ type }) => type === 'sftp')) {
      states.add((await testChannel(channel.id)).hostKey?.state)
    }

    expect(states).toEqual(new Set(['matches', 'unchecked', 'mismatch']))
  })
})
