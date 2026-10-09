import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  createFlowEndpoint,
  type Direction,
  type Flow,
  flowEndpoint,
  type FlowInput,
  flowSchema,
  flowsEndpoint,
  type FlowSummary,
  flowSummarySchema,
  type FlowUpdate,
  messageTypes,
  moveFlowMappingVersionEndpoint,
  updateFlowEndpoint,
} from '@edi-bridge/contracts'

import { type ChannelRecord, type ChannelStore, seedChannels, toChannelStore } from './channel'
import { directionOf, messageTypeDirections } from './direction'
import {
  type MappingCatalogue,
  mappingOfFlow,
  type MappingRecord,
  toMappingCatalogue,
} from './mapping-version'
import { badRequest, conflict, notFound, unprocessable } from './responses'
import { seedId } from './seed-id'
import { hasTraffic, seedTradingPartners } from './trading-partner'

export type FlowRecord = FlowSummary & Omit<FlowInput, keyof FlowSummary>

const seedSummaries: ReadonlyArray<FlowSummary> = seedTradingPartners
  .filter(hasTraffic)
  .flatMap((tradingPartner, tradingPartnerIndex) =>
    messageTypeDirections.map(({ messageType, direction }, flowIndex) =>
      flowSummarySchema.parse({
        id: seedId(2, tradingPartnerIndex * messageTypeDirections.length + flowIndex + 1),
        name: `${tradingPartner.name.split(' ')[0]} ${messageType} ${direction}`,
        tradingPartnerId: tradingPartner.id,
        messageType,
      }),
    ),
  )

export const seedMappings: ReadonlyArray<MappingRecord> = seedSummaries.map(mappingOfFlow)

const ownChannel = (direction: Direction) =>
  seedChannels.find(
    (channel) => channel.tradingPartnerId === null && channel.direction === direction,
  )!

function partnerChannel(tradingPartnerId: string, direction: Direction) {
  return seedChannels.find(
    (channel) => channel.tradingPartnerId === tradingPartnerId && channel.direction === direction,
  )!
}

// Inbound Messages come from the partner's SFTP inbox and go to the ERP; outbound ones come from
// the ERP's webhook and go to the partner's SFTP outbox.
function seedRoute({ tradingPartnerId, messageType }: FlowSummary) {
  return directionOf({ messageType }) === 'inbound'
    ? {
        inboundChannelId: partnerChannel(tradingPartnerId, 'inbound').id,
        destinationChannelId: ownChannel('outbound').id,
      }
    : {
        inboundChannelId: ownChannel('inbound').id,
        destinationChannelId: partnerChannel(tradingPartnerId, 'outbound').id,
      }
}

// Some Flows stay one or two versions behind, so the seed shows Flows with newer versions.
export const seedFlows: ReadonlyArray<FlowRecord> = seedSummaries.map((summary, index) => {
  const { versions } = seedMappings[index]!

  return {
    ...summary,
    ...seedRoute(summary),
    mappingVersionId: versions[Math.min([0, 1, 0, 2][index % 4]!, versions.length - 1)]!.id,
  }
})

export function createFlows({
  count,
  seed = 17,
  channels = seedChannels,
  mappings = seedMappings,
}: {
  count: number
  seed?: number
  channels?: ReadonlyArray<ChannelRecord>
  mappings?: ReadonlyArray<MappingRecord>
}): FlowRecord[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, (_, index) => {
    const tradingPartner = faker.helpers.arrayElement(seedTradingPartners)
    const messageType = faker.helpers.arrayElement(messageTypes)

    const fits = (direction: Direction) =>
      channels.filter(
        (channel) =>
          channel.direction === direction &&
          (channel.tradingPartnerId === null || channel.tradingPartnerId === tradingPartner.id),
      )

    const mapping = faker.helpers.arrayElement(
      mappings.filter((candidate) => candidate.messageType === messageType),
    )

    return {
      id: faker.string.uuid(),
      name: `${tradingPartner.name.split(' ')[0]} ${messageType} ${index + 1}`,
      tradingPartnerId: tradingPartner.id,
      messageType,
      inboundChannelId: faker.helpers.arrayElement(fits('inbound')).id,
      destinationChannelId: faker.helpers.arrayElement(fits('outbound')).id,
      mappingVersionId: faker.helpers.arrayElement(mapping.versions).id,
    }
  })
}

export function toFlow(record: FlowRecord, mappings: MappingCatalogue): Flow {
  const { mappingVersionId, ...rest } = record
  const pinned = mappings.find(mappingVersionId)

  if (!pinned) {
    throw new Error(`Flow ${record.id} pins the unknown Mapping Version ${mappingVersionId}`)
  }

  return flowSchema.parse({
    ...rest,
    mappingVersion: pinned.version,
    newerMappingVersions: pinned.mapping.versions.filter(
      ({ version }) => version > pinned.version.version,
    ),
  })
}

export type FlowStore = {
  all: () => readonly FlowRecord[]
  get: (id: string) => FlowRecord | undefined
  set: (flow: FlowRecord) => void
}

export function createFlowStore(flows: ReadonlyArray<FlowRecord> = seedFlows): FlowStore {
  const byId = new Map(flows.map((flow) => [flow.id, flow]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    set: (flow) => {
      byId.set(flow.id, flow)
    },
  }
}

export function toFlowStore(flows: ReadonlyArray<FlowRecord> | FlowStore = seedFlows) {
  return 'get' in flows ? flows : createFlowStore(flows)
}

type RouteCheck = Pick<FlowRecord, 'tradingPartnerId' | 'inboundChannelId' | 'destinationChannelId'>

function routeProblem(
  { tradingPartnerId, inboundChannelId, destinationChannelId }: RouteCheck,
  channels: ChannelStore,
) {
  const ends = [
    { id: inboundChannelId, direction: 'inbound', role: 'inbound Channel' },
    { id: destinationChannelId, direction: 'outbound', role: 'destination Channel' },
  ] as const

  for (const { id, direction, role } of ends) {
    const channel = channels.get(id)

    if (!channel) {
      return unprocessable(`The ${role} does not exist`)
    }

    if (channel.direction !== direction) {
      return unprocessable(`The ${role} must be an ${direction} Channel`)
    }

    if (channel.tradingPartnerId !== null && channel.tradingPartnerId !== tradingPartnerId) {
      return unprocessable(`The ${role} belongs to another Trading Partner`)
    }
  }

  return null
}

export function flowHandlers(
  apiUrl: string,
  {
    flows = seedFlows,
    channels = seedChannels,
    mappings = seedMappings,
  }: {
    flows?: ReadonlyArray<FlowRecord> | FlowStore
    channels?: ReadonlyArray<ChannelRecord> | ChannelStore
    mappings?: ReadonlyArray<MappingRecord> | MappingCatalogue
  } = {},
) {
  const store = toFlowStore(flows)
  const channelStore = toChannelStore(channels)
  const catalogue = toMappingCatalogue(mappings)

  const respond = (record: FlowRecord, status = 200) =>
    HttpResponse.json(toFlow(record, catalogue), { status })

  return [
    http.get(`${apiUrl}${flowsEndpoint.path}`, () =>
      HttpResponse.json(
        store
          .all()
          .map((record) => toFlow(record, catalogue))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      ),
    ),
    http.get<{ id: string }>(`${apiUrl}${flowEndpoint.path}`, ({ params }) => {
      const record = store.get(params.id)

      return record ? respond(record) : notFound()
    }),
    http.post(`${apiUrl}${createFlowEndpoint.path}`, async ({ request }) => {
      const body = createFlowEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const pinned = catalogue.find(body.data.mappingVersionId)

      if (!pinned) {
        return unprocessable('The Mapping Version is not published')
      }

      if (pinned.mapping.messageType !== body.data.messageType) {
        return unprocessable('The Mapping Version is for another Message Type')
      }

      const record: FlowRecord = { ...body.data, id: crypto.randomUUID() }

      const invalidRoute = routeProblem(record, channelStore)

      if (invalidRoute) {
        return invalidRoute
      }

      store.set(record)

      return respond(record, 201)
    }),
    http.put<{ id: string }>(`${apiUrl}${updateFlowEndpoint.path}`, async ({ params, request }) => {
      const existing = store.get(params.id)

      if (!existing) {
        return notFound()
      }

      const body = updateFlowEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const update: FlowUpdate = body.data
      const record: FlowRecord = { ...existing, ...update }

      const invalidRoute = routeProblem(record, channelStore)

      if (invalidRoute) {
        return invalidRoute
      }

      store.set(record)

      return respond(record)
    }),
    http.post<{ id: string }>(
      `${apiUrl}${moveFlowMappingVersionEndpoint.path}`,
      async ({ params, request }) => {
        const existing = store.get(params.id)

        if (!existing) {
          return notFound()
        }

        const body = moveFlowMappingVersionEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const current = catalogue.find(existing.mappingVersionId)!
        const target = catalogue.find(body.data.mappingVersionId)

        if (!target || target.mapping.mappingId !== current.mapping.mappingId) {
          return unprocessable('The Mapping Version does not belong to the Mapping of this Flow')
        }

        if (target.version.version <= current.version.version) {
          return conflict('A Flow only moves to a newer Mapping Version')
        }

        const record: FlowRecord = { ...existing, mappingVersionId: target.version.id }
        store.set(record)

        return respond(record)
      },
    ),
  ]
}
