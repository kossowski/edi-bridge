import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  createFlowEndpoint,
  flowEndpoint,
  type FlowInput,
  flowsEndpoint,
  type FlowUpdate,
  moveFlowMappingVersionEndpoint,
  publishedMappingVersionsEndpoint,
  toPath,
  toSearchParams,
  updateFlowEndpoint,
} from '@edi-bridge/contracts'

import { seedChannels } from './channel'
import {
  createFlows,
  createFlowStore,
  flowHandlers,
  type FlowRecord,
  seedFlows,
  seedMappings,
} from './flow'
import { createMappingCatalogue, publishedMappingVersionsHandler } from './mapping-version'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

function use(flows: ReadonlyArray<FlowRecord> = seedFlows) {
  server.use(
    ...flowHandlers(apiUrl, { flows: createFlowStore(flows) }),
    publishedMappingVersionsHandler(apiUrl, seedMappings),
  )
}

async function send(method: string, path: string, body?: Partial<FlowInput>) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

async function getFlow(id: string) {
  const response = await send('GET', toPath(flowEndpoint.path, { id }))

  return flowEndpoint.response.parse(await response.json())
}

function seeded(name: string) {
  return seedFlows.find((flow) => flow.name === name)!
}

function channelNamed(name: string) {
  return seedChannels.find((channel) => channel.name === name)!
}

const hansemarktOrders = seeded('Hansemarkt ORDERS inbound')

const hansemarkt = seedTradingPartners.find(({ name }) => name === 'Hansemarkt GmbH')!

const ordersVersion = seedMappings.find(({ messageType }) => messageType === 'ORDERS')!.versions[0]!

const newInput: FlowInput = {
  name: 'Hansemarkt ORDERS from the shop',
  tradingPartnerId: hansemarkt.id,
  messageType: 'ORDERS',
  inboundChannelId: channelNamed('Hansemarkt SFTP inbox').id,
  destinationChannelId: channelNamed('ERP HTTP delivery').id,
  mappingVersionId: ordersVersion.id,
}

describe('seed Flows', () => {
  it('keep the ids and names the Runs refer to', () => {
    expect(hansemarktOrders.id).toBe('00000002-0000-4000-8000-000000000001')
    expect(seedFlows.map(({ name }) => name)).toContain('Hansemarkt DESADV outbound')
  })

  it('route inbound Messages from the partner inbox to the ERP', () => {
    expect(hansemarktOrders).toMatchObject({
      inboundChannelId: channelNamed('Hansemarkt SFTP inbox').id,
      destinationChannelId: channelNamed('ERP HTTP delivery').id,
    })
  })

  it('include Flows pinned behind the newest Mapping Version', async () => {
    use()
    const response = await send('GET', flowsEndpoint.path)
    const flows = flowsEndpoint.response.parse(await response.json())

    expect(flows.some(({ newerMappingVersions }) => newerMappingVersions.length > 0)).toBe(true)
    expect(flows.some(({ newerMappingVersions }) => newerMappingVersions.length === 0)).toBe(true)
  })
})

describe('createFlows', () => {
  it('builds valid Flows on seed Channels and Mapping Versions', async () => {
    const flows = createFlows({ count: 50 })
    use(flows)

    const response = await send('GET', flowsEndpoint.path)

    expect(flowsEndpoint.response.parse(await response.json())).toHaveLength(50)
  })
})

describe('GET /mapping-versions', () => {
  it('lists the published versions for one Message Type', async () => {
    use()

    const response = await send(
      'GET',
      `${publishedMappingVersionsEndpoint.path}?${toSearchParams({ messageType: 'ORDERS' })}`,
    )

    const versions = publishedMappingVersionsEndpoint.response.parse(await response.json())

    const ordersMappings = new Set(
      seedMappings.filter(({ messageType }) => messageType === 'ORDERS').map((m) => m.mappingId),
    )

    expect(versions.length).toBeGreaterThan(0)
    expect(versions.every(({ mappingId }) => ordersMappings.has(mappingId))).toBe(true)
  })
})

describe('POST /flows', () => {
  it('creates a Flow pinned to the chosen Mapping Version', async () => {
    use()
    const response = await send('POST', createFlowEndpoint.path, newInput)
    const created = createFlowEndpoint.response.parse(await response.json())

    expect(response.status).toBe(201)
    expect(created.mappingVersion).toEqual(ordersVersion)
    await expect(getFlow(created.id)).resolves.toEqual(created)
  })

  it.each([
    [
      'an outbound Channel as the inbound one',
      { inboundChannelId: channelNamed('ERP HTTP delivery').id },
    ],
    [
      'an inbound Channel as the destination',
      { destinationChannelId: channelNamed('ERP webhook').id },
    ],
    ['a Channel that does not exist', { inboundChannelId: crypto.randomUUID() }],
    [
      "another Trading Partner's Channel",
      { inboundChannelId: channelNamed('Alpenfrisch SFTP inbox').id },
    ],
    ['an unpublished Mapping Version', { mappingVersionId: crypto.randomUUID() }],
    [
      'a Mapping Version for another Message Type',
      {
        mappingVersionId: seedMappings.find(({ messageType }) => messageType === 'INVOIC')!
          .versions[0]!.id,
      },
    ],
  ])('rejects %s', async (_, overrides) => {
    use()
    const response = await send('POST', createFlowEndpoint.path, { ...newInput, ...overrides })

    expect(response.status).toBe(422)
  })

  it('rejects an invalid body', async () => {
    use()
    const response = await send('POST', createFlowEndpoint.path, { ...newInput, name: '' })

    expect(response.status).toBe(400)
  })
})

describe('PUT /flows/:id', () => {
  const update: FlowUpdate = {
    name: 'Hansemarkt orders',
    inboundChannelId: channelNamed('ERP webhook').id,
    destinationChannelId: channelNamed('ERP HTTP delivery').id,
  }

  it('changes the route and keeps the pinned Mapping Version', async () => {
    use()
    const before = await getFlow(hansemarktOrders.id)
    const path = toPath(updateFlowEndpoint.path, { id: hansemarktOrders.id })
    const response = await send('PUT', path, { ...update, mappingVersionId: ordersVersion.id })
    const updated = updateFlowEndpoint.response.parse(await response.json())

    expect(updated).toMatchObject(update)
    expect(updated.mappingVersion).toEqual(before.mappingVersion)
  })

  it('rejects a destination that is an inbound Channel', async () => {
    use()
    const path = toPath(updateFlowEndpoint.path, { id: hansemarktOrders.id })

    const response = await send('PUT', path, {
      ...update,
      destinationChannelId: channelNamed('ERP webhook').id,
    })

    expect(response.status).toBe(422)
  })

  it('answers 404 for an unknown Flow', async () => {
    use()

    const response = await send(
      'PUT',
      toPath(updateFlowEndpoint.path, { id: crypto.randomUUID() }),
      update,
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /flows/:id/mapping-version', () => {
  const catalogue = createMappingCatalogue(seedMappings)

  const behind = seedFlows.find(({ mappingVersionId }) => {
    const pinned = catalogue.find(mappingVersionId)!

    return pinned.version.id !== pinned.mapping.versions[0]!.id
  })!

  const { mapping, version: pinned } = catalogue.find(behind.mappingVersionId)!

  const path = toPath(moveFlowMappingVersionEndpoint.path, { id: behind.id })

  it('moves the Flow to the chosen newer version', async () => {
    use()
    const newest = mapping.versions[0]!
    const response = await send('POST', path, { mappingVersionId: newest.id })
    const moved = moveFlowMappingVersionEndpoint.response.parse(await response.json())

    expect(moved.mappingVersion).toEqual(newest)
    expect(moved.newerMappingVersions).toEqual([])
    await expect(getFlow(behind.id)).resolves.toEqual(moved)
  })

  it('refuses to move back to an older or the same version', async () => {
    use()
    const response = await send('POST', path, { mappingVersionId: pinned.id })

    expect(response.status).toBe(409)
  })

  it('refuses a version of another Mapping', async () => {
    use()
    const other = seedMappings.find(({ mappingId }) => mappingId !== mapping.mappingId)!
    const response = await send('POST', path, { mappingVersionId: other.versions[0]!.id })

    expect(response.status).toBe(422)
  })

  it('never moves a Flow on its own', async () => {
    use()

    await expect(getFlow(behind.id)).resolves.toMatchObject({ mappingVersion: pinned })
  })
})
