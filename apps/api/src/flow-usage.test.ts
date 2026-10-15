import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  type ChannelInput,
  createChannelEndpoint,
  createdChannelSchema,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  documentStructureOrigins,
  flowSchema,
  lookupTableSchema,
  lookupTablesEndpoint,
  type MappingGraph,
  mappingSummarySchema,
  mappingsEndpoint,
  mappingVersionEntrySchema,
  mappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  tradingPartnerActivitiesEndpoint,
  tradingPartnerActivityEndpoint,
  tradingPartnerSchema,
} from '@edi-bridge/contracts'
import {
  channels,
  type Connection,
  documentStructures,
  flows,
  lookupTables,
  mappings,
  tradingPartners,
} from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let connection: Connection

let admin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(flows)
  await connection.db.delete(channels)
  await connection.db.delete(tradingPartners)
  await connection.db.delete(mappings)
  await connection.db.delete(documentStructures)
  await connection.db.delete(lookupTables)
})

const sent = async (options: InjectOptions, status = 201) => {
  const response = await admin.inject(options)

  expect(response.statusCode, response.body).toBe(status)

  return response.json<unknown>()
}

const createdTradingPartner = async (name: string) =>
  tradingPartnerSchema.parse(
    await sent({
      method: 'POST',
      url: createTradingPartnerEndpoint.path,
      body: { name, gln: null, characterSet: 'UNOC', acknowledgementTimeLimitHours: 24 },
    }),
  )

const createdChannel = async (input: ChannelInput) =>
  createdChannelSchema.parse(
    await sent({ method: 'POST', url: createChannelEndpoint.path, body: input }),
  ).channel

const sftpInbox = (tradingPartnerId: string | null): ChannelInput => ({
  type: 'sftp',
  direction: 'inbound',
  name: 'SFTP inbox',
  tradingPartnerId,
  host: 'sftp.hansemarkt.example',
  port: 22,
  username: 'nordwind',
  remotePath: '/outbox',
  authentication: 'password',
  pollingIntervalMinutes: 5,
  credential: 'sftp-password-4711',
})

const httpDelivery = (tradingPartnerId: string | null): ChannelInput => ({
  type: 'http',
  direction: 'outbound',
  name: 'HTTP delivery',
  tradingPartnerId,
  url: 'https://erp.nordwind-handel.example/api/edi/documents',
  authorization: null,
})

const emptyGraph: MappingGraph = { links: [], transforms: [], transformLinks: [] }

const orderNumber: MappingGraph = {
  links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
  transforms: [],
  transformLinks: [],
}

const translating = (lookupTableId: string): MappingGraph => ({
  links: [],
  transforms: [
    {
      id: '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
      kind: 'lookupTable',
      position: { x: 320, y: 80 },
      config: { lookupTableId, fallback: 'keepValue' },
    },
  ],
  transformLinks: [],
})

const createdMapping = async () => {
  await sent({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name: 'ERP ORDERS', origin: documentStructureOrigins.jsonDocument },
  })

  return mappingSummarySchema.parse(
    await sent({
      method: 'POST',
      url: createMappingEndpoint.path,
      body: { messageType: 'ORDERS' },
    }),
  )
}

const publishCounts = new Map<string, number>()

const published = async (mappingId: string, moveFlowIds: string[] = []) => {
  const count = publishCounts.get(mappingId) ?? 0

  await sent(
    {
      method: 'PUT',
      url: toPath(saveMappingDraftEndpoint.path, { id: mappingId }),
      body: count % 2 === 0 ? emptyGraph : orderNumber,
    },
    200,
  )

  const entry = mappingVersionEntrySchema.parse(
    await sent({
      method: 'POST',
      url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
      body: { changeNote: `Version ${count + 1}`, moveFlowIds },
    }),
  )

  publishCounts.set(mappingId, count + 1)

  return entry
}

const ownSystem = async () => ({ destination: await createdChannel(httpDelivery(null)) })

const createdFlow = async (
  name: string,
  tradingPartnerId: string,
  mappingVersionId: string,
  destinationChannelId: string,
) => {
  const inbound = await createdChannel(sftpInbox(tradingPartnerId))

  return flowSchema.parse(
    await sent({
      method: 'POST',
      url: createFlowEndpoint.path,
      body: {
        name,
        tradingPartnerId,
        messageType: 'ORDERS',
        inboundChannelId: inbound.id,
        destinationChannelId,
        mappingVersionId,
      },
    }),
  )
}

describe('GET /mappings', () => {
  it('names the Trading Partners whose Flows use a version of the Mapping, by name', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const alpenfrisch = await createdTradingPartner('Alpenfrisch Märkte AG')
    await createdTradingPartner('Kaufzentrum Nord')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    const second = await published(mapping.id)
    await createdFlow('Hansemarkt ORDERS', hansemarkt.id, first.id, destination.id)
    await createdFlow('Hansemarkt ORDERS 2', hansemarkt.id, second.id, destination.id)
    await createdFlow('Alpenfrisch ORDERS', alpenfrisch.id, second.id, destination.id)

    const [summary] = mappingsEndpoint.response.parse(
      await sent({ method: 'GET', url: mappingsEndpoint.path }, 200),
    )

    expect(summary?.partners).toEqual([
      { id: alpenfrisch.id, name: alpenfrisch.name },
      { id: hansemarkt.id, name: hansemarkt.name },
    ])
  })
})

const createdLookupTable = async () =>
  lookupTableSchema.parse(
    await sent({
      method: 'POST',
      url: createLookupTableEndpoint.path,
      body: {
        name: 'Mengeneinheiten',
        kind: 'units',
        scope: { kind: 'workspace' },
        entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
      },
    }),
  )

describe('GET /lookup-tables', () => {
  it('names the Trading Partners whose Flows run each Mapping that uses a Lookup Table', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const { destination } = await ownSystem()
    const units = await createdLookupTable()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    await createdFlow('Hansemarkt ORDERS', hansemarkt.id, first.id, destination.id)
    await sent(
      {
        method: 'PUT',
        url: toPath(saveMappingDraftEndpoint.path, { id: mapping.id }),
        body: translating(units.id),
      },
      200,
    )

    const [summary] = lookupTablesEndpoint.response.parse(
      await sent({ method: 'GET', url: lookupTablesEndpoint.path }, 200),
    )

    expect(summary?.uses).toEqual([
      {
        mappingId: mapping.id,
        name: mapping.name,
        messageType: 'ORDERS',
        direction: 'inbound',
        tradingPartners: [{ id: hansemarkt.id, name: hansemarkt.name }],
      },
    ])
  })
})

const historyOf = async (mappingId: string) =>
  mappingVersionsEndpoint.response.parse(
    await sent({ method: 'GET', url: toPath(mappingVersionsEndpoint.path, { mappingId }) }, 200),
  )

describe('GET /mappings/:mappingId/versions', () => {
  it('names the Flows pinned to each version with their Trading Partner', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const alpenfrisch = await createdTradingPartner('Alpenfrisch Märkte AG')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    const second = await published(mapping.id)
    const zentral = await createdFlow('Zentrallager', hansemarkt.id, second.id, destination.id)
    const filialen = await createdFlow('Filialen', hansemarkt.id, second.id, destination.id)
    const alpen = await createdFlow('Alpenfrisch ORDERS', alpenfrisch.id, second.id, destination.id)

    const history = await historyOf(mapping.id)

    expect(history.map(({ id, flows }) => ({ id, flows }))).toEqual([
      {
        id: second.id,
        flows: [
          {
            id: alpen.id,
            name: alpen.name,
            tradingPartner: { id: alpenfrisch.id, name: alpenfrisch.name },
          },
          {
            id: filialen.id,
            name: filialen.name,
            tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
          },
          {
            id: zentral.id,
            name: zentral.name,
            tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
          },
        ],
      },
      { id: first.id, flows: [] },
    ])
  })
})

describe('POST /mappings/:mappingId/versions with Flows to move', () => {
  it('pins the chosen Flows to the new version and leaves the others', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    const moved = await createdFlow('Filialen', hansemarkt.id, first.id, destination.id)
    const kept = await createdFlow('Zentrallager', hansemarkt.id, first.id, destination.id)

    const second = await published(mapping.id, [moved.id])

    expect(second.flows.map(({ id }) => id)).toEqual([moved.id])
    expect((await historyOf(mapping.id)).map(({ flows }) => flows.map(({ id }) => id))).toEqual([
      [moved.id],
      [kept.id],
    ])
  })

  it('answers 422 and publishes nothing for a Flow of another Mapping', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const other = await createdMapping()
    const first = await published(mapping.id)
    const elsewhere = await published(other.id)
    const flow = await createdFlow('Filialen', hansemarkt.id, elsewhere.id, destination.id)
    await sent(
      {
        method: 'PUT',
        url: toPath(saveMappingDraftEndpoint.path, { id: mapping.id }),
        body: orderNumber,
      },
      200,
    )

    const response = await admin.inject({
      method: 'POST',
      url: toPath(publishMappingDraftEndpoint.path, { mappingId: mapping.id }),
      body: { changeNote: '', moveFlowIds: [flow.id] },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'Only Flows that use this Mapping move to the new version.',
    })
    expect((await historyOf(mapping.id)).map(({ id }) => id)).toEqual([first.id])
  })
})

describe('the activity of a Trading Partner', () => {
  it('counts its Channels and Flows in the list', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const kaufzentrum = await createdTradingPartner('Kaufzentrum Nord')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    await createdFlow('Filialen', hansemarkt.id, first.id, destination.id)
    await createdFlow('Zentrallager', hansemarkt.id, first.id, destination.id)

    const activities = tradingPartnerActivitiesEndpoint.response.parse(
      await sent({ method: 'GET', url: tradingPartnerActivitiesEndpoint.path }, 200),
    )

    expect(
      activities.map(({ tradingPartnerId, channelCount, flowCount }) => ({
        tradingPartnerId,
        channelCount,
        flowCount,
      })),
    ).toEqual([
      { tradingPartnerId: hansemarkt.id, channelCount: 2, flowCount: 2 },
      { tradingPartnerId: kaufzentrum.id, channelCount: 0, flowCount: 0 },
    ])
  })

  it('names its Flows by name with their counts', async () => {
    const hansemarkt = await createdTradingPartner('Hansemarkt GmbH')
    const alpenfrisch = await createdTradingPartner('Alpenfrisch Märkte AG')
    const { destination } = await ownSystem()
    const mapping = await createdMapping()
    const first = await published(mapping.id)
    const zentral = await createdFlow('Zentrallager', hansemarkt.id, first.id, destination.id)
    const filialen = await createdFlow('Filialen', hansemarkt.id, first.id, destination.id)
    await createdFlow('Alpenfrisch ORDERS', alpenfrisch.id, first.id, destination.id)

    const activity = tradingPartnerActivityEndpoint.response.parse(
      await sent(
        { method: 'GET', url: toPath(tradingPartnerActivityEndpoint.path, { id: hansemarkt.id }) },
        200,
      ),
    )

    expect(activity).toMatchObject({ channelCount: 2, flowCount: 2 })
    expect(activity.flows).toEqual([
      { flow: { id: filialen.id, name: filialen.name }, runs: 0 },
      { flow: { id: zentral.id, name: zentral.name }, runs: 0 },
    ])
  })
})
