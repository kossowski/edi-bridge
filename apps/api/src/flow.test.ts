import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  type ChannelInput,
  createChannelEndpoint,
  createdChannelSchema,
  createDocumentStructureEndpoint,
  createFlowEndpoint,
  createMappingEndpoint,
  createTradingPartnerEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  flowEndpoint,
  type FlowInput,
  type MappingGraph,
  flowsEndpoint,
  mappingSummarySchema,
  mappingVersionEntrySchema,
  type MessageType,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  updateFlowEndpoint,
  moveFlowMappingVersionEndpoint,
  tradingPartnerSchema,
} from '@edi-bridge/contracts'
import {
  channels,
  type Connection,
  documentStructures,
  flows,
  mappings,
  mappingVersions,
  tradingPartners,
} from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

type Body = NonNullable<InjectOptions['body']>

let api: TestApi

let connection: Connection

let admin: Client

let viewer: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, viewer, otherAdmin } = api)
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
})

const sent = async (options: InjectOptions, status = 201, target = admin) => {
  const response = await target.inject(options)

  expect(response.statusCode, response.body).toBe(status)

  return response.json<unknown>()
}

const createdTradingPartner = async (name = 'Hansemarkt GmbH') =>
  tradingPartnerSchema.parse(
    await sent({
      method: 'POST',
      url: createTradingPartnerEndpoint.path,
      body: { name, gln: null, characterSet: 'UNOC', acknowledgementTimeLimitHours: 24 },
    }),
  )

const createdChannel = async (input: ChannelInput, target = admin) =>
  createdChannelSchema.parse(
    await sent({ method: 'POST', url: createChannelEndpoint.path, body: input }, 201, target),
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

const createdMapping = async (messageType: MessageType = 'ORDERS') => {
  const structure = documentStructureSchema.parse(
    await sent({
      method: 'POST',
      url: createDocumentStructureEndpoint.path,
      body: { name: `ERP ${messageType}`, origin: documentStructureOrigins.jsonDocument },
    }),
  )

  return mappingSummarySchema.parse(
    await sent({
      method: 'POST',
      url: createMappingEndpoint.path,
      body: { messageType, documentStructureId: structure.id },
    }),
  )
}

const emptyGraph: MappingGraph = { links: [], transforms: [], transformLinks: [] }

const orderNumber: MappingGraph = {
  links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
  transforms: [],
  transformLinks: [],
}

const publishCounts = new Map<string, number>()

const publishedVersions = async (mappingId: string, count: number) => {
  const versions = []

  for (let index = 0; index < count; index++) {
    const published = publishCounts.get(mappingId) ?? 0

    await sent(
      {
        method: 'PUT',
        url: toPath(saveMappingDraftEndpoint.path, { id: mappingId }),
        body: published % 2 === 0 ? emptyGraph : orderNumber,
      },
      200,
    )

    versions.push(
      mappingVersionEntrySchema.parse(
        await sent({
          method: 'POST',
          url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
          body: { changeNote: `Version ${published + 1}` },
        }),
      ),
    )

    publishCounts.set(mappingId, published + 1)
  }

  return versions
}

const ordersSetup = async () => {
  const tradingPartner = await createdTradingPartner()
  const inbound = await createdChannel(sftpInbox(tradingPartner.id))
  const destination = await createdChannel(httpDelivery(null))
  const mapping = await createdMapping('ORDERS')
  const [first] = await publishedVersions(mapping.id, 1)

  if (!first) {
    throw new Error('No Mapping Version published')
  }

  const input: FlowInput = {
    name: 'Hansemarkt ORDERS inbound',
    tradingPartnerId: tradingPartner.id,
    messageType: 'ORDERS',
    inboundChannelId: inbound.id,
    destinationChannelId: destination.id,
    mappingVersionId: first.id,
  }

  return { tradingPartner, inbound, destination, mapping, first, input }
}

const post = (body: Body, target = admin) =>
  target.inject({ method: 'POST', url: createFlowEndpoint.path, body })

const get = (id: string, target = admin) =>
  target.inject({ method: 'GET', url: toPath(flowEndpoint.path, { id }) })

const list = (target = admin) => target.inject({ method: 'GET', url: flowsEndpoint.path })

describe('POST /flows', () => {
  it('stores a Flow pinned to a Mapping Version', async () => {
    const { input, first } = await ordersSetup()

    const response = await post(input)

    expect(response.statusCode, response.body).toBe(201)

    const flow = createFlowEndpoint.response.parse(response.json())
    expect(flow).toEqual({
      id: flow.id,
      name: input.name,
      tradingPartnerId: input.tradingPartnerId,
      messageType: 'ORDERS',
      inboundChannelId: input.inboundChannelId,
      destinationChannelId: input.destinationChannelId,
      mappingVersion: {
        id: first.id,
        mappingId: first.mappingId,
        mappingName: first.mappingName,
        version: 1,
        publishedAt: first.publishedAt,
      },
      newerMappingVersions: [],
    })

    expect(flowEndpoint.response.parse((await get(flow.id)).json())).toEqual(flow)
    expect(flowsEndpoint.response.parse((await list()).json())).toEqual([flow])
  })
})

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const created = async (input: FlowInput) => {
  const response = await post(input)

  expect(response.statusCode, response.body).toBe(201)

  return createFlowEndpoint.response.parse(response.json())
}

describe('the Channels of a Flow', () => {
  it('take an outbound Message from the own systems to the Trading Partner', async () => {
    const tradingPartner = await createdTradingPartner()
    const mapping = await createdMapping('DESADV')
    const [version] = await publishedVersions(mapping.id, 1)

    const inbound = await createdChannel({
      type: 'webhook',
      direction: 'inbound',
      name: 'ERP webhook',
      tradingPartnerId: null,
      rateLimitPerMinute: 60,
    })

    const destination = await createdChannel({
      type: 'sftp',
      direction: 'outbound',
      name: 'SFTP outbox',
      tradingPartnerId: tradingPartner.id,
      host: 'sftp.hansemarkt.example',
      port: 22,
      username: 'nordwind',
      remotePath: '/inbox',
      authentication: 'password',
      credential: 'sftp-password-4711',
    })

    const response = await post({
      name: 'Hansemarkt DESADV outbound',
      tradingPartnerId: tradingPartner.id,
      messageType: 'DESADV',
      inboundChannelId: inbound.id,
      destinationChannelId: destination.id,
      mappingVersionId: version?.id ?? unknownId,
    })

    expect(response.statusCode, response.body).toBe(201)
  })

  it('answer 422 when they do not fit the Message Type and Trading Partner', async () => {
    const { input, inbound, destination } = await ordersSetup()

    const swapped = await post({
      ...input,
      inboundChannelId: destination.id,
      destinationChannelId: inbound.id,
    })

    expect(swapped.statusCode).toBe(422)
    expect(swapped.json()).toEqual({
      message: 'The inbound Channel does not fit the Message Type and Trading Partner of the Flow',
    })

    const otherPartner = await createdTradingPartner('Kaufring AG')
    const othersInbox = await createdChannel(sftpInbox(otherPartner.id))

    const foreign = await post({ ...input, inboundChannelId: othersInbox.id })

    expect(foreign.statusCode).toBe(422)

    const partnerDestination = await createdChannel(httpDelivery(input.tradingPartnerId))
    const toPartner = await post({ ...input, destinationChannelId: partnerDestination.id })

    expect(toPartner.statusCode).toBe(422)
    expect(toPartner.json()).toEqual({
      message:
        'The destination Channel does not fit the Message Type and Trading Partner of the Flow',
    })
  })

  it('answer 422 when one does not exist in the Workspace', async () => {
    const { input } = await ordersSetup()

    const response = await post({ ...input, destinationChannelId: unknownId })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'The destination Channel does not exist' })

    const othersDestination = await createdChannel(httpDelivery(null), otherAdmin)
    const otherWorkspaces = await post({ ...input, destinationChannelId: othersDestination.id })

    expect(otherWorkspaces.statusCode).toBe(422)
    expect(otherWorkspaces.json()).toEqual({ message: 'The destination Channel does not exist' })
  })
})

describe('the pinned Mapping Version', () => {
  it('answers 422 when it is unknown or for another Message Type', async () => {
    const { input } = await ordersSetup()

    const unknown = await post({ ...input, mappingVersionId: unknownId })

    expect(unknown.statusCode).toBe(422)
    expect(unknown.json()).toEqual({ message: 'The Mapping Version is not published' })

    const invoices = await createdMapping('INVOIC')
    const [invoiceVersion] = await publishedVersions(invoices.id, 1)

    const other = await post({ ...input, mappingVersionId: invoiceVersion?.id ?? unknownId })

    expect(other.statusCode).toBe(422)
    expect(other.json()).toEqual({ message: 'The Mapping Version is for another Message Type' })
  })

  it('lists the newer versions of its Mapping, newest first', async () => {
    const { input, mapping } = await ordersSetup()
    const [second, third] = await publishedVersions(mapping.id, 2)

    const flow = await created(input)

    expect(flow.newerMappingVersions.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: third?.id, version: 3 },
      { id: second?.id, version: 2 },
    ])
  })
})

describe('a Flow request', () => {
  it('answers 422 for an unknown Trading Partner and 400 for an invalid body', async () => {
    const { input } = await ordersSetup()

    expect((await post({ ...input, tradingPartnerId: unknownId })).statusCode).toBe(422)
    expect((await post({ ...input, name: ' ' })).statusCode).toBe(400)
  })

  it('answers 403 for a Viewer', async () => {
    const { input } = await ordersSetup()

    expect((await post(input, viewer)).statusCode).toBe(403)
  })
})

describe('the Flows of another Workspace', () => {
  it('are neither listed nor found', async () => {
    const { input } = await ordersSetup()
    const flow = await created(input)

    expect((await list(otherAdmin)).json()).toEqual([])
    expect((await get(flow.id, otherAdmin)).statusCode).toBe(404)
    expect((await get('not-a-uuid')).statusCode).toBe(404)
  })
})

const update = (id: string, body: Body, target = admin) =>
  target.inject({ method: 'PUT', url: toPath(updateFlowEndpoint.path, { id }), body })

describe('PUT /flows/:id', () => {
  it('changes the name and Channels and keeps the pinned Mapping Version', async () => {
    const { input, tradingPartner } = await ordersSetup()
    const flow = await created(input)
    const secondInbox = await createdChannel(sftpInbox(tradingPartner.id))

    const changes = {
      name: 'Hansemarkt orders',
      inboundChannelId: secondInbox.id,
      destinationChannelId: input.destinationChannelId,
    }

    const response = await update(flow.id, { ...changes, mappingVersionId: unknownId })

    expect(response.statusCode, response.body).toBe(200)
    expect(updateFlowEndpoint.response.parse(response.json())).toEqual({ ...flow, ...changes })
    expect((await get(flow.id)).json()).toEqual(response.json())
  })

  it('answers 422 for a Channel that does not fit', async () => {
    const { input } = await ordersSetup()
    const flow = await created(input)

    const response = await update(flow.id, {
      name: flow.name,
      inboundChannelId: input.destinationChannelId,
      destinationChannelId: input.destinationChannelId,
    })

    expect(response.statusCode).toBe(422)
  })

  it("answers 404 for another Workspace's Flow", async () => {
    const { input } = await ordersSetup()
    const flow = await created(input)

    expect((await update(flow.id, { ...input }, otherAdmin)).statusCode).toBe(404)
  })
})

const move = (id: string, mappingVersionId: string, target = admin) =>
  target.inject({
    method: 'POST',
    url: toPath(moveFlowMappingVersionEndpoint.path, { id }),
    body: { mappingVersionId },
  })

describe('POST /flows/:id/mapping-version', () => {
  it('moves the Flow to a newer version of its Mapping', async () => {
    const { input, mapping } = await ordersSetup()
    const flow = await created(input)
    const [second, third] = await publishedVersions(mapping.id, 2)

    const response = await move(flow.id, second?.id ?? unknownId)

    expect(response.statusCode, response.body).toBe(200)

    const moved = moveFlowMappingVersionEndpoint.response.parse(response.json())

    expect(moved.mappingVersion.version).toBe(2)
    expect(moved.newerMappingVersions.map(({ id }) => id)).toEqual([third?.id])
    expect((await get(flow.id)).json()).toEqual(response.json())
  })

  it('answers 409 for the same or an older version', async () => {
    const { input, mapping, first } = await ordersSetup()
    const [second] = await publishedVersions(mapping.id, 1)
    const flow = await created({ ...input, mappingVersionId: second?.id ?? unknownId })

    const older = await move(flow.id, first.id)

    expect(older.statusCode).toBe(409)
    expect(older.json()).toEqual({ message: 'A Flow only moves to a newer Mapping Version' })
    expect((await move(flow.id, second?.id ?? unknownId)).statusCode).toBe(409)
  })

  it('answers 422 for a version of another Mapping', async () => {
    const { input } = await ordersSetup()
    const flow = await created(input)
    const other = await createdMapping('ORDERS')
    const [, otherVersion] = await publishedVersions(other.id, 2)

    const response = await move(flow.id, otherVersion?.id ?? unknownId)

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'The Mapping Version does not belong to the Mapping of this Flow',
    })
  })

  it("answers 404 for another Workspace's Flow and 403 for a Viewer", async () => {
    const { input, mapping } = await ordersSetup()
    const flow = await created(input)
    const [second] = await publishedVersions(mapping.id, 1)

    expect((await move(flow.id, second?.id ?? unknownId, otherAdmin)).statusCode).toBe(404)
    expect((await move(flow.id, second?.id ?? unknownId, viewer)).statusCode).toBe(403)
  })
})

describe('the records a Flow uses', () => {
  it('cannot be deleted while the Flow exists', async () => {
    const { input, mapping } = await ordersSetup()
    await created(input)

    await expect(
      connection.db.delete(channels).where(eq(channels.id, input.destinationChannelId)),
    ).rejects.toThrow()
    await expect(
      connection.db.delete(mappingVersions).where(eq(mappingVersions.id, input.mappingVersionId)),
    ).rejects.toThrow()
    await expect(
      connection.db.delete(mappings).where(eq(mappings.id, mapping.id)),
    ).rejects.toThrow()
  })

  it('go with the Flow when its Trading Partner is deleted', async () => {
    const { input } = await ordersSetup()
    await created(input)

    await connection.db
      .delete(tradingPartners)
      .where(eq(tradingPartners.id, input.tradingPartnerId))

    expect((await list()).json()).toEqual([])
  })
})
