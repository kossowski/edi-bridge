import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type ChannelInput,
  channelsEndpoint,
  createChannelEndpoint,
  createFlowEndpoint,
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createTradingPartnerEndpoint,
  documentStructureEndpoint,
  documentStructuresEndpoint,
  flowEndpoint,
  type FlowInput,
  type LookupTableInput,
  lookupTableEndpoint,
  lookupTablesEndpoint,
  type MappingGraph,
  mappingDraftEndpoint,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  mappingsEndpoint,
  mappingVersionsEndpoint,
  messageTypeStructureEndpoint,
  overviewEndpoint,
  publishedMappingVersionsEndpoint,
  publishMappingDraftEndpoint,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  type RunListQuery,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  saveMappingDraftEndpoint,
  submitDocumentEndpoint,
  toPath,
  toSearchParams,
  type TradingPartnerInput,
  tradingPartnerSchema,
  updateDocumentStructureEndpoint,
  updateLookupTableEndpoint,
  updateTradingPartnerEndpoint,
} from '@edi-bridge/contracts'

import {
  createDocumentStructure,
  createHandlers,
  createMappingDrafts,
  createMappingSample,
  documentStructureOrigins,
  seedChannels,
  seedDocumentStructureOf,
  seedFlows,
  seedLookupTableNamed,
  seedMappingDrafts,
  seedTradingPartners,
} from './index'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function listRuns(query: Partial<RunListQuery>) {
  const response = await fetch(`${apiUrl}${runsEndpoint.path}?${toSearchParams(query)}`)

  return runListSchema.parse(await response.json())
}

async function getRun(id: string) {
  const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id })}`)

  return runDetailSchema.parse(await response.json())
}

async function send(method: string, path: string, body: TradingPartnerInput | LookupTableInput) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(path: string, body?: ReprocessRunBody) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })

  return runDetailSchema.parse(await response.json())
}

describe('createHandlers', () => {
  it('lists a retried Run as delivered', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    const failed = runs[0]!

    await post(toPath(retryRunEndpoint.path, { id: failed.id }))

    const { runs: listed } = await listRuns({
      flowId: [failed.flow.id],
      receivedFrom: failed.receivedAt,
      receivedTo: failed.receivedAt,
    })

    expect(listed.find(({ id }) => id === failed.id)).toMatchObject({
      status: 'delivered',
      failureStage: null,
    })
  })

  it('counts a retried Run as delivered on the Overview', async () => {
    server.use(...createHandlers(apiUrl))

    const { runs } = await listRuns({
      status: ['failed'],
      failureStage: ['delivery'],
      receivedFrom: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    })

    const failed = runs[0]!

    const failedInWindow = async () => {
      const response = await fetch(`${apiUrl}${overviewEndpoint.path}?window=24h`)
      const { tradingPartners } = overviewEndpoint.response.parse(await response.json())

      return tradingPartners.find(
        ({ tradingPartner }) => tradingPartner.id === failed.tradingPartner.id,
      )?.failed
    }

    const before = await failedInWindow()
    await post(toPath(retryRunEndpoint.path, { id: failed.id }))

    expect(await failedInWindow()).toBe(before! - 1)
  })

  it('lists the Run that a Reprocess started', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['mapping'] })
    const details = await Promise.all(runs.map(({ id }) => getRun(id)))
    const failed = details.find(({ replacedBy }) => replacedBy === null)!

    const versionsResponse = await fetch(
      `${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId: failed.mappingVersion!.mappingId })}`,
    )

    const [latest] = mappingVersionsEndpoint.response.parse(await versionsResponse.json())

    const replacing = await post(toPath(reprocessRunEndpoint.path, { id: failed.id }), {
      mappingVersionId: latest!.id,
    })

    const { runs: listed } = await listRuns({ flowId: [failed.flow.id], pageSize: 1 })

    expect(listed[0]).toMatchObject({ id: replacing.id, status: 'delivered' })
  })

  it('offers a version published within the same createHandlers call to Flows and Reprocess', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['mapping'] })
    const details = await Promise.all(runs.map(({ id }) => getRun(id)))
    const failed = details.find(({ replacedBy }) => replacedBy === null)!
    const { mappingId } = failed.mappingVersion!

    await fetch(`${apiUrl}${toPath(saveMappingDraftEndpoint.path, { id: mappingId })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ links: [], transforms: [], transformLinks: [] }),
    })

    const published = publishMappingDraftEndpoint.response.parse(
      await (
        await fetch(`${apiUrl}${toPath(publishMappingDraftEndpoint.path, { mappingId })}`, {
          method: 'POST',
        })
      ).json(),
    )

    const offered = publishedMappingVersionsEndpoint.response.parse(
      await (
        await fetch(
          `${apiUrl}${publishedMappingVersionsEndpoint.path}?${toSearchParams({ messageType: failed.messageType })}`,
        )
      ).json(),
    )

    const flow = flowEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(flowEndpoint.path, { id: failed.flow.id })}`)).json(),
    )

    const replacing = await post(toPath(reprocessRunEndpoint.path, { id: failed.id }), {
      mappingVersionId: published.id,
    })

    expect(offered).toContainEqual(published)
    expect(flow.newerMappingVersions).toContainEqual(published)
    expect(replacing.mappingVersion).toEqual(published)
  })

  it('keeps the changes of one createHandlers call out of another', async () => {
    server.use(...createHandlers(apiUrl))
    const { runs } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })
    await post(toPath(retryRunEndpoint.path, { id: runs[0]!.id }))

    server.resetHandlers(...createHandlers(apiUrl))
    const { runs: fresh } = await listRuns({ status: ['failed'], failureStage: ['delivery'] })

    expect(fresh[0]?.id).toBe(runs[0]!.id)
  })

  it('keeps a created Channel within one createHandlers call', async () => {
    server.use(...createHandlers(apiUrl, { channels: [] }))

    await fetch(`${apiUrl}${createChannelEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'webhook',
        direction: 'inbound',
        name: 'Shop webhook',
        tradingPartnerId: null,
        rateLimitPerMinute: 60,
      }),
    })

    const listChannels = async () =>
      channelsEndpoint.response.parse(
        await (await fetch(`${apiUrl}${channelsEndpoint.path}`)).json(),
      )

    expect(await listChannels()).toHaveLength(1)

    server.resetHandlers(...createHandlers(apiUrl, { channels: [] }))

    expect(await listChannels()).toEqual([])
  })

  it('lets a Flow use a Channel created within the same createHandlers call', async () => {
    server.use(...createHandlers(apiUrl))

    const post = (path: string, body: ChannelInput | FlowInput) =>
      fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const { channel } = createChannelEndpoint.response.parse(
      await (
        await post(createChannelEndpoint.path, {
          type: 'webhook',
          direction: 'inbound',
          name: 'Shop webhook',
          tradingPartnerId: null,
          rateLimitPerMinute: 60,
        })
      ).json(),
    )

    const flow = seedFlows.find(({ messageType }) => messageType === 'DESADV')!

    const response = await post(createFlowEndpoint.path, {
      ...flow,
      name: 'Shop DESADV',
      inboundChannelId: channel.id,
    })

    expect(response.status).toBe(201)
  })

  it('lists and shows the Runs of a Manual Submission', async () => {
    server.use(...createHandlers(apiUrl))
    const inbox = seedChannels.find(({ name }) => name === 'Hansemarkt SFTP inbox')!
    await listRuns({})
    await getRun((await listRuns({ pageSize: 1 })).runs[0]!.id)

    const response = await fetch(`${apiUrl}${submitDocumentEndpoint.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: inbox.id,
        document: { fileName: 'notes.txt', content: 'Please ship by Friday.' },
      }),
    })

    const { runs } = submitDocumentEndpoint.response.parse(await response.json())
    const { runs: listed } = await listRuns({ manualSubmission: true, pageSize: 1 })

    expect(listed[0]?.id).toBe(runs[0]!.id)
    expect(await getRun(runs[0]!.id)).toMatchObject({
      manualSubmission: true,
      status: 'failed',
      failureStage: 'parse',
      direction: 'inbound',
    })
  })

  it('serves the Mapping canvas with both of its trees', async () => {
    server.use(...createHandlers(apiUrl))

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    const inbound = mappings.find(({ direction }) => direction === 'inbound')!

    const draft = mappingDraftEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingDraftEndpoint.path, inbound)}`)).json(),
    )

    const trees = await Promise.all([
      fetch(`${apiUrl}${toPath(messageTypeStructureEndpoint.path, inbound)}`),
      fetch(
        `${apiUrl}${toPath(documentStructureEndpoint.path, { id: inbound.documentStructureId })}`,
      ),
    ])

    expect(draft.mappingId).toBe(inbound.id)
    expect(trees.map(({ status }) => status)).toEqual([200, 200])
  })

  it('serves custom Mapping Drafts with their Document Structures', async () => {
    const documentStructure = createDocumentStructure({ fieldCount: 400 })
    const mappingDrafts = createMappingDrafts({ count: 2, documentStructures: [documentStructure] })

    server.use(
      ...createHandlers(apiUrl, { mappingDrafts, documentStructures: [documentStructure] }),
    )

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    const structure = await fetch(
      `${apiUrl}${toPath(documentStructureEndpoint.path, documentStructure)}`,
    )

    expect(mappings.map(({ id }) => id).sort()).toEqual(mappingDrafts.map(({ id }) => id).sort())
    expect(documentStructureEndpoint.response.parse(await structure.json())).toEqual(
      documentStructure,
    )
  })

  it('shows a renamed Document Structure in the Mapping list of the same call', async () => {
    server.use(...createHandlers(apiUrl))
    const { id } = seedDocumentStructureOf.ORDERS

    await fetch(`${apiUrl}${toPath(updateDocumentStructureEndpoint.path, { id })}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ERP order v2', adjustments: [] }),
    })

    const mappings = mappingsEndpoint.response.parse(
      await (await fetch(`${apiUrl}${mappingsEndpoint.path}`)).json(),
    )

    expect(mappings.filter(({ documentStructureId }) => documentStructureId === id)).not.toEqual([])

    for (const mapping of mappings.filter(
      ({ documentStructureId }) => documentStructureId === id,
    )) {
      expect(mapping.documentStructureName).toBe('ERP order v2')
    }
  })

  it('lists a Document Structure created within the same createHandlers call', async () => {
    server.use(...createHandlers(apiUrl))

    const created = createDocumentStructureEndpoint.response.parse(
      await (
        await fetch(`${apiUrl}${createDocumentStructureEndpoint.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'ERP order',
            origin: documentStructureOrigins.jsonDocument,
          }),
        })
      ).json(),
    )

    const summaries = documentStructuresEndpoint.response.parse(
      await (await fetch(`${apiUrl}${documentStructuresEndpoint.path}`)).json(),
    )

    expect(summaries.find(({ id }) => id === created.id)).toMatchObject({ mappings: [] })
  })

  it('lists Lookup Tables for the Lookup Table node, and none when asked', async () => {
    const listLookupTables = async () =>
      lookupTablesEndpoint.response.parse(
        await (await fetch(`${apiUrl}${lookupTablesEndpoint.path}`)).json(),
      )

    server.use(...createHandlers(apiUrl))
    expect((await listLookupTables()).length).toBeGreaterThan(0)

    server.resetHandlers(...createHandlers(apiUrl, { lookupTables: [] }))
    expect(await listLookupTables()).toEqual([])
  })

  it('scopes a Lookup Table to a Trading Partner created in the same session', async () => {
    server.use(...createHandlers(apiUrl))

    const partnerResponse = await send('POST', createTradingPartnerEndpoint.path, {
      name: 'Havelland Feinkost GmbH',
      gln: '4012345000009',
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: 24,
    })

    const partner = tradingPartnerSchema.parse(await partnerResponse.json())

    const response = await send('POST', createLookupTableEndpoint.path, {
      name: 'Havelland units',
      scope: { kind: 'tradingPartner', tradingPartnerId: partner.id },
      entries: [],
    })

    expect(response.status).toBe(201)
    expect(lookupTableEndpoint.response.parse(await response.json()).scope).toEqual({
      kind: 'tradingPartner',
      tradingPartner: { id: partner.id, name: 'Havelland Feinkost GmbH' },
    })
  })

  it('shows the current name of a renamed Trading Partner in Lookup Table scopes', async () => {
    server.use(...createHandlers(apiUrl))
    const hansemarkt = seedTradingPartners.find(({ name }) => name === 'Hansemarkt GmbH')!
    const units = seedLookupTableNamed('Hansemarkt units')

    await send('PUT', toPath(updateTradingPartnerEndpoint.path, hansemarkt), {
      name: 'Hansemarkt Nord GmbH',
      gln: hansemarkt.gln,
      characterSet: hansemarkt.characterSet,
      acknowledgementTimeLimitHours: hansemarkt.acknowledgementTimeLimitHours,
    })

    const table = lookupTableEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(lookupTableEndpoint.path, units)}`)).json(),
    )

    const listed = lookupTablesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${lookupTablesEndpoint.path}`)).json(),
    )

    const renamed = {
      kind: 'tradingPartner',
      tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt Nord GmbH' },
    }

    expect(table.scope).toEqual(renamed)
    expect(listed.find(({ id }) => id === units.id)?.scope).toEqual(renamed)
  })

  it('previews a Lookup Table node with the entries saved for the table', async () => {
    server.use(...createHandlers(apiUrl))
    const vat = seedLookupTableNamed('VAT categories')
    const invoic = seedMappingDrafts.find(({ name }) => name === 'Hansemarkt: ERP JSON to INVOIC')!
    const transformId = '0000000b-0000-4000-8000-000000000001'

    const graph: MappingGraph = {
      links: [],
      transforms: [
        {
          id: transformId,
          kind: 'lookupTable',
          position: { x: 0, y: 0 },
          config: { lookupTableId: vat.id, fallback: 'fail' },
        },
      ],
      transformLinks: [
        {
          from: { kind: 'source', path: 'lines[].vatRate' },
          to: { kind: 'transform', transformId, input: 'value' },
        },
        {
          from: { kind: 'transform', transformId, output: 'value' },
          to: { kind: 'target', path: 'SG25/SG33/TAX+7/C241/5153' },
        },
      ],
    }

    const [sample] = mappingSamplesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingSamplesEndpoint.path, invoic)}`)).json(),
    )

    await fetch(`${apiUrl}${toPath(updateLookupTableEndpoint.path, vat)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: vat.name,
        scope: { kind: 'workspace' },
        entries: [
          { sourceCode: '19', targetCode: 'E' },
          { sourceCode: '7', targetCode: 'E' },
        ],
      }),
    })

    const response = await fetch(`${apiUrl}${toPath(mappingPreviewEndpoint.path, invoic)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sampleId: sample!.id, graph }),
    })

    const preview = mappingPreviewEndpoint.response.parse(await response.json())
    const lines = preview.document.format === 'edifact' ? preview.document.content.split('\n') : []
    const taxLines = lines.filter((line) => line.startsWith('TAX+7+'))

    expect(taxLines).not.toHaveLength(0)
    expect(taxLines.every((line) => line.startsWith('TAX+7+E+'))).toBe(true)
    expect(preview.notes).toEqual([])
  })

  it('serves the samples and previews of custom Mapping Drafts', async () => {
    const documentStructure = createDocumentStructure({ fieldCount: 40 })
    const [mapping] = createMappingDrafts({ count: 1, documentStructures: [documentStructure] })
    const sample = createMappingSample({ mapping: mapping!, documentStructure })

    server.use(
      ...createHandlers(apiUrl, {
        mappingDrafts: [mapping!],
        documentStructures: [documentStructure],
        mappingSamples: [sample],
      }),
    )

    const samples = mappingSamplesEndpoint.response.parse(
      await (await fetch(`${apiUrl}${toPath(mappingSamplesEndpoint.path, mapping!)}`)).json(),
    )

    const preview = await fetch(`${apiUrl}${toPath(mappingPreviewEndpoint.path, mapping!)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sampleId: sample.id,
        graph: { links: mapping!.links, transforms: [], transformLinks: [] },
      }),
    })

    expect(samples.map(({ id }) => id)).toEqual([sample.id])
    expect(mappingPreviewEndpoint.response.parse(await preview.json()).sampleId).toBe(sample.id)
  })
})
