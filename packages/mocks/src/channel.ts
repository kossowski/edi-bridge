import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type Channel,
  channelEndpoint,
  type ChannelInput,
  channelInputSchema,
  channelSchema,
  channelsEndpoint,
  type ChannelUpdate,
  createChannelEndpoint,
  type MaskedSecret,
  regenerateWebhookTokenEndpoint,
  toPath,
  updateChannelEndpoint,
  webhookPath,
  webhookTokenSchema,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { hasTraffic, seedTradingPartners } from './trading-partner'

type WebhookInput = Extract<ChannelInput, { type: 'webhook' }>

// What the server stores: the plaintext secrets stay here and only leave masked, via toChannel.
export type ChannelRecord = { id: string } & (
  Exclude<ChannelInput, { type: 'webhook' }> | (WebhookInput & { token: string })
)

type ChannelKind = Pick<ChannelInput, 'type' | 'direction'>

const channelKinds: ReadonlyArray<ChannelKind> = [
  { type: 'sftp', direction: 'inbound' },
  { type: 'sftp', direction: 'outbound' },
  { type: 'webhook', direction: 'inbound' },
  { type: 'http', direction: 'outbound' },
]

const hidden: MaskedSecret = { lastFour: null }

function lastFour(secret: string): MaskedSecret {
  return { lastFour: secret.slice(-4) }
}

export function randomWebhookToken(faker: Faker = defaultFaker) {
  return webhookTokenSchema.parse(
    `whk_${faker.string.alphanumeric({ length: 32, casing: 'mixed' })}`,
  )
}

export function toChannel(record: ChannelRecord, apiUrl: string): Channel {
  switch (record.type) {
    case 'sftp':
      return channelSchema.parse({ ...record, credential: hidden })
    case 'webhook': {
      const { token, ...rest } = record

      return channelSchema.parse({
        ...rest,
        url: `${apiUrl}${toPath(webhookPath, record)}`,
        token: lastFour(token),
      })
    }

    case 'http':
      return channelSchema.parse({
        ...record,
        authorization: record.authorization === null ? null : hidden,
      })
  }
}

function parseRecord(record: ChannelRecord): ChannelRecord {
  channelInputSchema.parse(record)

  if (record.type === 'webhook') {
    webhookTokenSchema.parse(record.token)
  }

  toChannel(record, 'https://api.edi-bridge.example')

  return record
}

function generateChannel(
  faker: Faker,
  { type, direction }: ChannelKind,
  tradingPartnerIds: ReadonlyArray<string>,
  id: string,
): ChannelRecord {
  const tradingPartnerId =
    tradingPartnerIds.length > 0 && faker.datatype.boolean({ probability: 0.8 })
      ? faker.helpers.arrayElement(tradingPartnerIds)
      : null

  const company = faker.company.name()
  const domain = `${faker.internet.domainWord()}.example`

  const sftp = {
    tradingPartnerId,
    host: `sftp.${domain}`,
    port: faker.helpers.weightedArrayElement([
      { value: 22, weight: 8 },
      { value: 2222, weight: 2 },
    ]),
    username: faker.internet.username().toLowerCase(),
    authentication: faker.helpers.arrayElement(['password', 'privateKey'] as const),
    credential: faker.internet.password({ length: 24 }),
  }

  if (type === 'sftp' && direction === 'inbound') {
    return {
      id,
      type,
      direction,
      name: `${company} SFTP inbox`,
      ...sftp,
      remotePath: '/outbox',
      pollingIntervalMinutes: faker.helpers.arrayElement([1, 1, 1, 5, 15, 60]),
    }
  }

  if (type === 'sftp') {
    return {
      id,
      type,
      direction: 'outbound',
      name: `${company} SFTP outbox`,
      ...sftp,
      remotePath: '/inbox',
    }
  }

  if (type === 'webhook') {
    return {
      id,
      type,
      direction: 'inbound',
      name: `${company} webhook`,
      tradingPartnerId,
      rateLimitPerMinute: faker.helpers.arrayElement([30, 60, 60, 120, 600]),
      token: randomWebhookToken(faker),
    }
  }

  return {
    id,
    type: 'http',
    direction: 'outbound',
    name: `${company} HTTP delivery`,
    tradingPartnerId,
    url: `https://erp.${domain}/api/edi/documents`,
    authorization: faker.datatype.boolean({ probability: 0.8 })
      ? `Bearer ${faker.string.alphanumeric(40)}`
      : null,
  }
}

const seedTrafficPartners = seedTradingPartners.filter(hasTraffic)

const erpSeeds: ReadonlyArray<ChannelRecord> = [
  {
    id: seedId(3, 1),
    type: 'webhook',
    direction: 'inbound',
    name: 'ERP webhook',
    tradingPartnerId: null,
    rateLimitPerMinute: 60,
    token: randomWebhookToken(seededFaker(`webhook:${seedId(3, 1)}`)),
  },
  {
    id: seedId(3, 2),
    type: 'http',
    direction: 'outbound',
    name: 'ERP HTTP delivery',
    tradingPartnerId: null,
    url: 'https://erp.nordwind-handel.example/api/edi/documents',
    authorization: `Bearer ${seededFaker(`authorization:${seedId(3, 2)}`).string.alphanumeric(40)}`,
  },
]

const tradingPartnerSeeds = seedTrafficPartners.flatMap(
  (tradingPartner, index): ChannelRecord[] => {
    const shortName = tradingPartner.name.split(' ')[0] ?? tradingPartner.name
    const faker = seededFaker(`sftp:${tradingPartner.id}`)

    const sftp = {
      tradingPartnerId: tradingPartner.id,
      host: `sftp.${shortName.toLowerCase()}.example`,
      port: 22,
      username: 'nordwind',
      authentication: index % 2 === 0 ? 'password' : 'privateKey',
      credential: faker.internet.password({ length: 24 }),
    } as const

    return [
      {
        id: seedId(3, erpSeeds.length + index * 2 + 1),
        type: 'sftp',
        direction: 'inbound',
        name: `${shortName} SFTP inbox`,
        ...sftp,
        remotePath: '/outbox',
        pollingIntervalMinutes: index === 1 ? 5 : 1,
      },
      {
        id: seedId(3, erpSeeds.length + index * 2 + 2),
        type: 'sftp',
        direction: 'outbound',
        name: `${shortName} SFTP outbox`,
        ...sftp,
        remotePath: '/inbox',
      },
    ]
  },
)

export const seedChannels: ReadonlyArray<ChannelRecord> = [...erpSeeds, ...tradingPartnerSeeds].map(
  parseRecord,
)

export function createChannel(
  kind: ChannelKind = { type: 'sftp', direction: 'inbound' },
  { tradingPartnerIds = [] }: { tradingPartnerIds?: ReadonlyArray<string> } = {},
): ChannelRecord {
  return parseRecord(
    generateChannel(defaultFaker, kind, tradingPartnerIds, defaultFaker.string.uuid()),
  )
}

export function createChannels({
  count,
  seed = 13,
  tradingPartnerIds = [],
}: {
  count: number
  seed?: number
  tradingPartnerIds?: ReadonlyArray<string>
}): ChannelRecord[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, () =>
    parseRecord(
      generateChannel(
        faker,
        faker.helpers.weightedArrayElement(
          channelKinds.map((value) => ({ value, weight: value.type === 'sftp' ? 3 : 1 })),
        ),
        tradingPartnerIds,
        faker.string.uuid(),
      ),
    ),
  )
}

export type ChannelStore = {
  all: () => readonly ChannelRecord[]
  get: (id: string) => ChannelRecord | undefined
  set: (channel: ChannelRecord) => void
}

export function createChannelStore(
  channels: ReadonlyArray<ChannelRecord> = seedChannels,
): ChannelStore {
  const byId = new Map(channels.map((channel) => [channel.id, channel]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (channel) => {
      byId.set(channel.id, channel)
    },
  }
}

export function toChannelStore(
  channels: ReadonlyArray<ChannelRecord> | ChannelStore = seedChannels,
) {
  return 'get' in channels ? channels : createChannelStore(channels)
}

type UpdateResult = ChannelRecord | 'kindChanged' | 'credentialRequired'

function applyUpdate(existing: ChannelRecord, update: ChannelUpdate): UpdateResult {
  if (update.type !== existing.type || update.direction !== existing.direction) {
    return 'kindChanged'
  }

  if (update.type === 'sftp' && existing.type === 'sftp') {
    if (update.credential === undefined && update.authentication !== existing.authentication) {
      return 'credentialRequired'
    }

    return { ...update, id: existing.id, credential: update.credential ?? existing.credential }
  }

  if (update.type === 'webhook' && existing.type === 'webhook') {
    return { ...update, id: existing.id, token: existing.token }
  }

  if (update.type === 'http' && existing.type === 'http') {
    return {
      ...update,
      id: existing.id,
      authorization:
        update.authorization === undefined ? existing.authorization : update.authorization,
    }
  }

  return 'kindChanged'
}

export function channelHandlers(
  apiUrl: string,
  { channels = seedChannels }: { channels?: ReadonlyArray<ChannelRecord> | ChannelStore } = {},
) {
  const store = toChannelStore(channels)

  const notFound = () => HttpResponse.json({ message: 'Not found' }, { status: 404 })

  const badRequest = (message: string) => HttpResponse.json({ message }, { status: 400 })

  return [
    http.get(`${apiUrl}${channelsEndpoint.path}`, () =>
      HttpResponse.json(
        store
          .all()
          .map((record) => toChannel(record, apiUrl))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      ),
    ),
    http.get<{ id: string }>(`${apiUrl}${channelEndpoint.path}`, ({ params }) => {
      const record = store.get(params.id)

      return record ? HttpResponse.json(toChannel(record, apiUrl)) : notFound()
    }),
    http.post(`${apiUrl}${createChannelEndpoint.path}`, async ({ request }) => {
      const body = createChannelEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const id = crypto.randomUUID()

      const record: ChannelRecord =
        body.data.type === 'webhook'
          ? { ...body.data, id, token: randomWebhookToken() }
          : { ...body.data, id }

      const webhookToken = record.type === 'webhook' ? record.token : null

      store.set(record)

      return HttpResponse.json(
        { channel: toChannel(record, apiUrl), webhookToken },
        { status: 201 },
      )
    }),
    http.put<{ id: string }>(
      `${apiUrl}${updateChannelEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        const body = updateChannelEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const updated = applyUpdate(existing, body.data)

        if (updated === 'kindChanged') {
          return HttpResponse.json(
            { message: 'The type and direction of a Channel cannot change' },
            { status: 409 },
          )
        }

        if (updated === 'credentialRequired') {
          return badRequest('A new credential is required when the authentication method changes')
        }

        store.set(updated)

        return HttpResponse.json(toChannel(updated, apiUrl))
      },
    ),
    http.post<{ id: string }>(`${apiUrl}${regenerateWebhookTokenEndpoint.path}`, ({ params }) => {
      const existing = store.get(params.id)

      if (!existing) {
        return notFound()
      }

      if (existing.type !== 'webhook') {
        return HttpResponse.json({ message: 'Only webhook Channels have a token' }, { status: 409 })
      }

      const updated = { ...existing, token: randomWebhookToken() }
      store.set(updated)

      return HttpResponse.json({ channel: toChannel(updated, apiUrl), webhookToken: updated.token })
    }),
  ]
}
