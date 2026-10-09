import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  createFlowEndpoint,
  directionOf,
  fitsFlow,
  type Flow,
  type FlowChannelField,
  flowChannelFields,
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
    messageTypes.map((messageType, flowIndex) =>
      flowSummarySchema.parse({
        id: seedId(2, tradingPartnerIndex * messageTypes.length + flowIndex + 1),
        name: `${tradingPartner.name.split(' ')[0]} ${messageType} ${directionOf({ messageType })}`,
        tradingPartnerId: tradingPartner.id,
        messageType,
      }),
    ),
  )

export const seedMappings: ReadonlyArray<MappingRecord> = seedSummaries.map(mappingOfFlow)

function channelsFitting(
  channels: ReadonlyArray<ChannelRecord>,
  field: FlowChannelField,
  flow: Pick<FlowSummary, 'messageType' | 'tradingPartnerId'>,
) {
  return channels.filter((channel) => fitsFlow(channel, field, flow))
}

// Inbound Messages come from the partner's SFTP inbox and go to the ERP; outbound ones come from
// the ERP's webhook and go to the partner's SFTP outbox.
function seedFlowChannels(summary: FlowSummary) {
  return {
    inboundChannelId: channelsFitting(seedChannels, 'inboundChannelId', summary)[0]!.id,
    destinationChannelId: channelsFitting(seedChannels, 'destinationChannelId', summary)[0]!.id,
  }
}

// Some Flows stay one or two versions behind, so the seed shows Flows with newer versions.
export const seedFlows: ReadonlyArray<FlowRecord> = seedSummaries.map((summary, index) => {
  const { versions } = seedMappings[index]!

  return {
    ...summary,
    ...seedFlowChannels(summary),
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
    const messageType = faker.helpers.arrayElement(messageTypes)

    const tradingPartner = faker.helpers.arrayElement(
      seedTradingPartners.filter((candidate) =>
        flowChannelFields.every(
          (field) =>
            channelsFitting(channels, field, { messageType, tradingPartnerId: candidate.id })
              .length > 0,
        ),
      ),
    )

    const flow = { messageType, tradingPartnerId: tradingPartner.id }

    const mapping = faker.helpers.arrayElement(
      mappings.filter((candidate) => candidate.messageType === messageType),
    )

    return {
      ...flow,
      id: faker.string.uuid(),
      name: `${tradingPartner.name.split(' ')[0]} ${messageType} ${index + 1}`,
      inboundChannelId: faker.helpers.arrayElement(
        channelsFitting(channels, 'inboundChannelId', flow),
      ).id,
      destinationChannelId: faker.helpers.arrayElement(
        channelsFitting(channels, 'destinationChannelId', flow),
      ).id,
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

const roles = {
  inboundChannelId: 'inbound Channel',
  destinationChannelId: 'destination Channel',
} as const satisfies Record<FlowChannelField, string>

function channelProblem(
  flow: Pick<FlowRecord, 'messageType' | 'tradingPartnerId' | FlowChannelField>,
  channels: ChannelStore,
) {
  for (const field of flowChannelFields) {
    const channel = channels.get(flow[field])

    if (!channel) {
      return unprocessable(`The ${roles[field]} does not exist`)
    }

    if (!fitsFlow(channel, field, flow)) {
      return unprocessable(
        `The ${roles[field]} does not fit the Message Type and Trading Partner of the Flow`,
      )
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

      const invalidChannel = channelProblem(record, channelStore)

      if (invalidChannel) {
        return invalidChannel
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

      const invalidChannel = channelProblem(record, channelStore)

      if (invalidChannel) {
        return invalidChannel
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
