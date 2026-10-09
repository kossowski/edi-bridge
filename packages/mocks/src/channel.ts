import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type Channel,
  channelEndpoint,
  type ChannelInput,
  channelInputSchema,
  type ChannelKind,
  channelKinds,
  channelSchema,
  channelsEndpoint,
  type ChannelUpdate,
  createChannelEndpoint,
  type Direction,
  type MaskedSecret,
  regenerateWebhookTokenEndpoint,
  sftpAuthentications,
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

type SftpConnection = Omit<
  Extract<ChannelRecord, { type: 'sftp'; direction: 'outbound' }>,
  'id' | 'type' | 'direction' | 'name' | 'remotePath'
>

const hidden: MaskedSecret = { lastFour: null }

function lastFour(secret: string): MaskedSecret {
  return { lastFour: secret.slice(-4) }
}

export function randomWebhookToken(faker: Faker = defaultFaker) {
  return webhookTokenSchema.parse(
    `whk_${faker.string.alphanumeric({ length: 32, casing: 'mixed' })}`,
  )
}

// The web build points NEXT_PUBLIC_API_URL at the reverse proxy (/api), but the webhook URL is
// handed to senders outside the browser, so it must be absolute.
function webhookUrl(apiUrl: string, id: string) {
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin

  return new URL(`${apiUrl}${toPath(webhookPath, { id })}`, origin).href
}

export function toChannel(record: ChannelRecord, apiUrl: string): Channel {
  switch (record.type) {
    case 'sftp':
      return channelSchema.parse({ ...record, credential: hidden })
    case 'webhook': {
      const { token, ...rest } = record

      return channelSchema.parse({
        ...rest,
        url: webhookUrl(apiUrl, record.id),
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

  assertServable(record)

  return record
}

// Catches a record that would leak a secret or break the response contract when it is created,
// not on the first GET. The API URL does not matter for that.
function assertServable(record: ChannelRecord) {
  toChannel(record, '')
}

function sftpConnection(
  faker: Faker,
  tradingPartnerId: string | null,
  host: string,
  overrides: Partial<SftpConnection> = {},
): SftpConnection {
  return {
    tradingPartnerId,
    host,
    port: 22,
    username: 'nordwind',
    authentication: faker.helpers.arrayElement(sftpAuthentications),
    credential: faker.internet.password({ length: 24 }),
    ...overrides,
  }
}

function sftpChannel(
  id: string,
  direction: Direction,
  label: string,
  connection: SftpConnection,
  pollingIntervalMinutes: number,
): ChannelRecord {
  const base = { id, type: 'sftp', ...connection } as const

  return direction === 'inbound'
    ? {
        ...base,
        direction,
        name: `${label} SFTP inbox`,
        remotePath: '/outbox',
        pollingIntervalMinutes,
      }
    : { ...base, direction, name: `${label} SFTP outbox`, remotePath: '/inbox' }
}

function generateChannel(
  faker: Faker,
  kind: ChannelKind,
  tradingPartnerIds: ReadonlyArray<string>,
  id: string,
): ChannelRecord {
  const tradingPartnerId =
    tradingPartnerIds.length > 0 && faker.datatype.boolean({ probability: 0.8 })
      ? faker.helpers.arrayElement(tradingPartnerIds)
      : null

  const company = faker.company.name()
  const domain = `${faker.internet.domainWord()}.example`

  switch (kind.type) {
    case 'sftp':
      return sftpChannel(
        id,
        kind.direction,
        company,
        sftpConnection(faker, tradingPartnerId, `sftp.${domain}`, {
          port: faker.helpers.weightedArrayElement([
            { value: 22, weight: 8 },
            { value: 2222, weight: 2 },
          ]),
          username: faker.internet.username().toLowerCase(),
        }),
        faker.helpers.arrayElement([1, 1, 1, 5, 15, 60]),
      )
    case 'webhook':
      return {
        id,
        ...kind,
        name: `${company} webhook`,
        tradingPartnerId,
        rateLimitPerMinute: faker.helpers.arrayElement([30, 60, 60, 120, 600]),
        token: randomWebhookToken(faker),
      }
    case 'http':
      return {
        id,
        ...kind,
        name: `${company} HTTP delivery`,
        tradingPartnerId,
        url: `https://erp.${domain}/api/edi/documents`,
        authorization: faker.datatype.boolean({ probability: 0.8 })
          ? `Bearer ${faker.string.alphanumeric(40)}`
          : null,
      }
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

    const connection = sftpConnection(
      seededFaker(`sftp:${tradingPartner.id}`),
      tradingPartner.id,
      `sftp.${shortName.toLowerCase()}.example`,
      { authentication: index % 2 === 0 ? 'password' : 'privateKey' },
    )

    return (['inbound', 'outbound'] as const).map((direction, offset) =>
      sftpChannel(
        seedId(3, erpSeeds.length + index * 2 + offset + 1),
        direction,
        shortName,
        connection,
        index === 1 ? 5 : 1,
      ),
    )
  },
)

export const seedChannels: ReadonlyArray<ChannelRecord> = [...erpSeeds, ...tradingPartnerSeeds].map(
  parseRecord,
)

export function createChannel(
  kind: ChannelKind = channelKinds[0],
  { tradingPartnerIds = [] }: { tradingPartnerIds?: ReadonlyArray<string> } = {},
): ChannelRecord {
  return parseRecord(
    generateChannel(defaultFaker, kind, tradingPartnerIds, defaultFaker.string.uuid()),
  )
}

export function createChannels({
  count,
  seed = 13,
  tradingPartnerIds = seedTradingPartners.map(({ id }) => id),
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

function conflict(message: string) {
  return HttpResponse.json({ message }, { status: 409 })
}

function badRequest(message: string) {
  return HttpResponse.json({ message }, { status: 400 })
}

function applyUpdate(
  existing: ChannelRecord,
  update: ChannelUpdate,
): { record: ChannelRecord } | { response: Response } {
  const kindChanged = () => ({
    response: conflict('The type and direction of a Channel cannot change'),
  })

  if (update.type !== existing.type || update.direction !== existing.direction) {
    return kindChanged()
  }

  if (update.type === 'sftp' && existing.type === 'sftp') {
    if (update.credential === undefined && update.authentication !== existing.authentication) {
      return {
        response: badRequest('A new credential is required when the authentication method changes'),
      }
    }

    return {
      record: { ...update, id: existing.id, credential: update.credential ?? existing.credential },
    }
  }

  if (update.type === 'webhook' && existing.type === 'webhook') {
    return { record: { ...update, id: existing.id, token: existing.token } }
  }

  if (update.type === 'http' && existing.type === 'http') {
    return {
      record: {
        ...update,
        id: existing.id,
        authorization:
          update.authorization === undefined ? existing.authorization : update.authorization,
      },
    }
  }

  return kindChanged()
}

export function channelHandlers(
  apiUrl: string,
  { channels = seedChannels }: { channels?: ReadonlyArray<ChannelRecord> | ChannelStore } = {},
) {
  const store = toChannelStore(channels)

  const notFound = () => HttpResponse.json({ message: 'Not found' }, { status: 404 })

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

        if ('response' in updated) {
          return updated.response
        }

        store.set(updated.record)

        return HttpResponse.json(toChannel(updated.record, apiUrl))
      },
    ),
    http.post<{ id: string }>(`${apiUrl}${regenerateWebhookTokenEndpoint.path}`, ({ params }) => {
      const existing = store.get(params.id)

      if (!existing) {
        return notFound()
      }

      if (existing.type !== 'webhook') {
        return conflict('Only webhook Channels have a token')
      }

      const updated = { ...existing, token: randomWebhookToken() }
      store.set(updated)

      return HttpResponse.json({ channel: toChannel(updated, apiUrl), webhookToken: updated.token })
    }),
  ]
}
