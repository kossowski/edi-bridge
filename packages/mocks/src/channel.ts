import { en, Faker, faker as defaultFaker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  acceptHostKeyEndpoint,
  type Channel,
  channelEndpoint,
  type ChannelInput,
  channelInputSchema,
  type ChannelKind,
  type ChannelTestResultReason,
  type ChannelTestResult,
  channelKinds,
  channelSchema,
  channelsEndpoint,
  type ChannelUpdate,
  createChannelEndpoint,
  type Direction,
  type HostKeyFingerprint,
  hostKeyFingerprintSchema,
  type MaskedSecret,
  type PollProblem,
  regenerateWebhookTokenEndpoint,
  sftpAuthentications,
  testChannelEndpoint,
  type TestedHostKey,
  toPath,
  updateChannelEndpoint,
  webhookPath,
  webhookTokenSchema,
} from '@edi-bridge/contracts'

import { allOf, type Listing } from './listing'
import { badRequest, conflict, notFound, unprocessable } from './responses'
import { seedId } from './seed-id'
import { seededFaker } from './seeded-faker'
import { hasTraffic, seedTradingPartners } from './trading-partner'

import type { FlowRecord } from './flow'

type WebhookInput = Extract<ChannelInput, { type: 'webhook' }>

type InboundSftpInput = Extract<ChannelInput, { type: 'sftp'; direction: 'inbound' }>

// What the server stores: the plaintext secrets stay here and only leave masked, via toChannel.
export type ChannelRecord = { id: string } & (
  | Exclude<ChannelInput, WebhookInput | InboundSftpInput>
  | (InboundSftpInput & { pollProblem?: PollProblem | null })
  | (WebhookInput & { token: string })
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
    case 'sftp': {
      const channel = {
        ...record,
        credential: hidden,
        hostKeyFingerprint: record.hostKeyFingerprint ?? null,
      }

      return channelSchema.parse(
        record.direction === 'inbound'
          ? { ...channel, pollProblem: record.pollProblem ?? null }
          : channel,
      )
    }

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

const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Seeded by host, so every test of one server shows one key and a mismatch stays reproducible.
export function serverHostKey(host: string): HostKeyFingerprint {
  const faker = seededFaker(`hostKey:${host}`)

  return hostKeyFingerprintSchema.parse(
    `SHA256:${faker.string.fromCharacters(base64, 42)}${faker.helpers.arrayElement([...'AEIMQUYcgkosw048'])}`,
  )
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

const replacedServerPartnerIndex = 2

// The second partner's Channels predate the host key check.
function seedHostKey(host: string, index: number) {
  switch (index) {
    case 1:
      return null
    case replacedServerPartnerIndex:
      return serverHostKey(`old.${host}`)
    default:
      return serverHostKey(host)
  }
}

const replacedServerPollProblem = {
  pollProblem: { reason: 'hostKeyMismatch', since: '2026-10-14T06:42:00.000Z' },
} as const

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

// Each seed Trading Partner runs one SFTP server, named after the first word of its name.
function seedSftpServer(tradingPartner: { name: string }) {
  const shortName = tradingPartner.name.split(' ')[0] ?? tradingPartner.name

  return { shortName, host: `sftp.${shortName.toLowerCase()}.example` }
}

const tradingPartnerSeeds = seedTrafficPartners.flatMap(
  (tradingPartner, index): ChannelRecord[] => {
    const { shortName, host } = seedSftpServer(tradingPartner)

    const connection = sftpConnection(
      seededFaker(`sftp:${tradingPartner.id}`),
      tradingPartner.id,
      host,
      {
        authentication: index % 2 === 0 ? 'password' : 'privateKey',
        hostKeyFingerprint: seedHostKey(host, index),
      },
    )

    return (['inbound', 'outbound'] as const).map((direction, offset) => {
      const channel = sftpChannel(
        seedId(3, erpSeeds.length + index * 2 + offset + 1),
        direction,
        shortName,
        connection,
        index === 1 ? 5 : 1,
      )

      return index === replacedServerPartnerIndex && direction === 'inbound'
        ? { ...channel, ...replacedServerPollProblem }
        : channel
    })
  },
)

// Chose Message Types in both directions, but postponed the outbound Channel.
const postponedOutboundSeeds = seedTradingPartners
  .filter((tradingPartner) => !hasTraffic(tradingPartner) && tradingPartner.messageTypes)
  .map((tradingPartner, index): ChannelRecord => {
    const { shortName, host } = seedSftpServer(tradingPartner)

    return sftpChannel(
      seedId(3, erpSeeds.length + tradingPartnerSeeds.length + index + 1),
      'inbound',
      shortName,
      sftpConnection(seededFaker(`sftp:${tradingPartner.id}`), tradingPartner.id, host, {
        hostKeyFingerprint: serverHostKey(host),
      }),
      1,
    )
  })

export const seedChannels: ReadonlyArray<ChannelRecord> = [
  ...erpSeeds,
  ...tradingPartnerSeeds,
  ...postponedOutboundSeeds,
].map(parseRecord)

const internalHost = '10.20.0.15'

// Not a seed, so the seeded screens keep their Channels: pass it to channelHandlers to show it.
export const blockedAddressChannel: ChannelRecord = parseRecord({
  id: seedId(3, 900),
  type: 'sftp',
  direction: 'inbound',
  name: 'Warehouse SFTP inbox',
  remotePath: '/outbox',
  pollingIntervalMinutes: 1,
  ...sftpConnection(seededFaker(`sftp:${internalHost}`), null, internalHost),
  pollProblem: {
    reason: 'addressBlocked',
    since: '2026-10-19T05:10:00.000Z',
    blockedAddress: internalHost,
  },
})

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
        response: unprocessable(
          'A new credential is required when the authentication method changes',
        ),
      }
    }

    return {
      record: {
        ...update,
        ...(existing.direction === 'inbound' && { pollProblem: existing.pollProblem }),
        id: existing.id,
        credential: update.credential ?? existing.credential,
        hostKeyFingerprint:
          update.hostKeyFingerprint === undefined
            ? existing.hostKeyFingerprint
            : update.hostKeyFingerprint,
      },
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

const awaitingContrl = seedTradingPartners.find(
  ({ testMode, onboarding }) =>
    testMode && onboarding.testInterchangeSentAt !== null && onboarding.contrlReceivedAt === null,
)

const rejectedLogin = seedChannels.find(
  ({ type, direction, tradingPartnerId }) =>
    type === 'sftp' && direction === 'outbound' && tradingPartnerId === awaitingContrl?.id,
)

// A mismatching host key and a blocked address follow from the Channel, never from this list.
export type ConnectionFailure = Exclude<
  ChannelTestResultReason,
  'hostKeyMismatch' | 'addressBlocked'
>

export const seedConnectionFailures: ReadonlyMap<string, ConnectionFailure> = new Map(
  rejectedLogin ? [[rejectedLogin.id, 'loginRejected']] : [],
)

const unreached: ReadonlySet<ConnectionFailure> = new Set([
  'hostUnreachable',
  'timedOut',
  'seededChannel',
])

export function refusesHostKey(record: ChannelRecord) {
  return (
    record.type === 'sftp' &&
    record.hostKeyFingerprint != null &&
    record.hostKeyFingerprint !== serverHostKey(record.host)
  )
}

// The mock resolves no host name but localhost, so only an address literal reaches another one.
const internalAddress =
  /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]:)/i

function hostOf(record: ChannelRecord): string | undefined {
  switch (record.type) {
    case 'sftp':
      return record.host
    case 'http':
      return new URL(record.url).hostname.replace(/^\[(.*)\]$/, '$1')
    case 'webhook':
      return undefined
  }
}

function blockedAddressOf(record: ChannelRecord): string | undefined {
  const host = hostOf(record)
  const address = host === 'localhost' ? '127.0.0.1' : host

  return address !== undefined && internalAddress.test(address) ? address : undefined
}

function testedHostKey(
  record: ChannelRecord,
  failure: ConnectionFailure | undefined,
): TestedHostKey | null {
  if (record.type !== 'sftp' || (failure && unreached.has(failure))) {
    return null
  }

  const fingerprint = serverHostKey(record.host)
  const confirmed = record.hostKeyFingerprint ?? null

  return {
    fingerprint,
    state: confirmed === null ? 'unchecked' : confirmed === fingerprint ? 'matches' : 'mismatch',
  }
}

function testResult(
  record: ChannelRecord,
  failure: ConnectionFailure | undefined,
): ChannelTestResult {
  const testedAt = new Date().toISOString()
  const blockedAddress = blockedAddressOf(record)

  if (blockedAddress !== undefined) {
    return { outcome: 'failed', reason: 'addressBlocked', blockedAddress, testedAt, hostKey: null }
  }

  const hostKey = testedHostKey(record, failure)

  if (hostKey?.state === 'mismatch') {
    return { outcome: 'failed', reason: 'hostKeyMismatch', testedAt, hostKey }
  }

  return failure
    ? { outcome: 'failed', reason: failure, testedAt, hostKey }
    : { outcome: 'succeeded', testedAt, hostKey }
}

function usedByFlow(flows: Listing<FlowRecord>, channelId: string) {
  return allOf(flows).some(
    ({ inboundChannelId, destinationChannelId }) =>
      inboundChannelId === channelId || destinationChannelId === channelId,
  )
}

export function channelHandlers(
  apiUrl: string,
  {
    channels = seedChannels,
    flows = [],
    connectionFailures = seedConnectionFailures,
  }: {
    channels?: ReadonlyArray<ChannelRecord> | ChannelStore
    flows?: Listing<FlowRecord>
    connectionFailures?: ReadonlyMap<string, ConnectionFailure>
  } = {},
) {
  const store = toChannelStore(channels)
  const failures = new Map(connectionFailures)

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

        if (
          body.data.tradingPartnerId !== existing.tradingPartnerId &&
          usedByFlow(flows, existing.id)
        ) {
          return conflict('The Trading Partner of a Channel cannot change while a Flow uses it')
        }

        const updated = applyUpdate(existing, body.data)

        if ('response' in updated) {
          return updated.response
        }

        store.set(updated.record)
        failures.delete(existing.id)

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
    http.post<{ id: string }>(`${apiUrl}${testChannelEndpoint.path}`, ({ params }) => {
      const record = store.get(params.id)

      return record ? HttpResponse.json(testResult(record, failures.get(params.id))) : notFound()
    }),
    http.put<{ id: string }>(
      `${apiUrl}${acceptHostKeyEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        if (existing.type !== 'sftp') {
          return conflict('Only SFTP Channels have a host key')
        }

        const body = acceptHostKeyEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const updated = { ...existing, hostKeyFingerprint: body.data.hostKeyFingerprint }
        store.set(updated)

        return HttpResponse.json(toChannel(updated, apiUrl))
      },
    ),
  ]
}
