import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  channelHandlers,
  createRun,
  createTradingPartner as buildTradingPartner,
  createWorkspace,
  lookupTablesHandler,
  mappingHandlers,
  seedMappingDrafts,
  runDetailHandlers,
  runsHandler,
  seedLookupTables,
  tradingPartnerHandlers,
  workspaceHandlers,
} from '@edi-bridge/mocks'

import {
  createChannel,
  createTradingPartner,
  getChannel,
  getRun,
  listLookupTables,
  listMappingVersions,
  listRuns,
  regenerateWebhookToken,
  reprocessRun,
  retryRun,
  saveMappingDraft,
  switchToProduction,
  updateCompanyIdentity,
  updateTradingPartner,
} from './client'
import { apiUrl } from './config'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

const partnerA = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Partner A' }

const partnerB = { id: '00000000-0000-4000-8000-0000000000b2', name: 'Partner B' }

const partnerC = { id: '00000000-0000-4000-8000-0000000000c3', name: 'Partner C' }

const runs = [
  createRun({
    id: '00000000-0000-4000-8000-000000000001',
    receivedAt: '2026-10-03T08:00:00.000Z',
    manualSubmission: true,
    status: 'delivered',
    failureStage: null,
    tradingPartner: partnerA,
  }),
  createRun({
    id: '00000000-0000-4000-8000-000000000002',
    receivedAt: '2026-10-02T08:00:00.000Z',
    manualSubmission: false,
    status: 'failed',
    failureStage: 'parse',
    tradingPartner: partnerB,
  }),
  createRun({
    id: '00000000-0000-4000-8000-000000000003',
    receivedAt: '2026-10-01T08:00:00.000Z',
    manualSubmission: true,
    status: 'delivered',
    failureStage: null,
    tradingPartner: partnerC,
  }),
]

describe('Run detail actions', () => {
  const deliveryFailure = createRun({
    id: '00000000-0000-4000-8000-000000000011',
    messageType: 'ORDERS',
    status: 'failed',
    failureStage: 'delivery',
  })

  const mappingFailure = createRun({
    id: '00000000-0000-4000-8000-000000000012',
    messageType: 'ORDERS',
    status: 'failed',
    failureStage: 'mapping',
  })

  it('retries a delivery failure and gets the delivered Run back', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [deliveryFailure] }))

    const run = await retryRun(deliveryFailure.id)

    expect(run).toMatchObject({ id: deliveryFailure.id, status: 'delivered' })
  })

  it('reprocesses a mapping failure with the chosen Mapping Version', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [mappingFailure] }))
    const { mappingVersion } = await getRun(mappingFailure.id)
    const versions = await listMappingVersions(mappingVersion!.mappingId)

    const run = await reprocessRun(mappingFailure.id, { mappingVersionId: versions.at(-1)!.id })

    expect(run.replaces).toEqual({ id: mappingFailure.id })
    expect(run.mappingVersion).toEqual(versions.at(-1))
  })

  it('rejects with the response status when an action is not allowed', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [mappingFailure] }))

    await expect(retryRun(mappingFailure.id)).rejects.toMatchObject({
      status: 409,
      path: `/runs/${mappingFailure.id}/retry`,
    })
  })
})

describe('listRuns', () => {
  it.each([
    [true, ['00000000-0000-4000-8000-000000000001']],
    [false, ['00000000-0000-4000-8000-000000000002']],
  ])(
    'filters by Manual Submission = %s together with multi-value filters',
    async (manualSubmission, expected) => {
      server.use(runsHandler(apiUrl, runs))

      const result = await listRuns({
        status: ['delivered', 'failed'],
        tradingPartnerId: [partnerA.id, partnerB.id],
        manualSubmission,
        page: 1,
        pageSize: 50,
      })

      expect(result.runs.map((run) => run.id)).toEqual(expected)
    },
  )
})

describe('Trading Partner actions', () => {
  const existing = buildTradingPartner({
    id: '00000000-0000-4000-8000-0000000000d4',
    gln: '0200000000011',
    testMode: true,
    onboarding: {
      testInterchangeSentAt: '2026-10-01T08:00:00.000Z',
      contrlReceivedAt: '2026-10-01T08:05:00.000Z',
    },
  })

  const input = {
    name: 'Kieler Kontor GmbH',
    gln: '0234567890129',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 12,
  } as const

  it('creates a Trading Partner in Test Mode', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    await expect(createTradingPartner(input)).resolves.toMatchObject({ ...input, testMode: true })
  })

  it('rejects with 409 when another Trading Partner uses the GLN', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [existing] }))

    await expect(updateTradingPartner(existing.id, input)).resolves.toMatchObject(input)
    await expect(createTradingPartner({ ...input, name: 'Other' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('switches a Trading Partner to production', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [existing] }))

    await expect(switchToProduction(existing.id)).resolves.toMatchObject({ testMode: false })
  })

  it('records the company GLN of the Workspace', async () => {
    server.use(...workspaceHandlers(apiUrl, createWorkspace({ gln: null })))

    await expect(updateCompanyIdentity({ gln: '0212345000007' })).resolves.toMatchObject({
      gln: '0212345000007',
    })
  })
})

describe('Channel actions', () => {
  it('returns the webhook token only on create and regenerate', async () => {
    server.use(...channelHandlers(apiUrl, { channels: [] }))

    const created = await createChannel({
      type: 'webhook',
      direction: 'inbound',
      name: 'Shop webhook',
      tradingPartnerId: null,
      rateLimitPerMinute: 60,
    })

    const token = created.webhookToken!
    const read = await getChannel(created.channel.id)
    const regenerated = await regenerateWebhookToken(created.channel.id)

    expect(read).toMatchObject({ token: { lastFour: token.slice(-4) } })
    expect(regenerated.webhookToken).not.toBe(token)
    expect(regenerated.channel).toMatchObject({
      token: { lastFour: regenerated.webhookToken.slice(-4) },
    })
  })
})

describe('saveMappingDraft', () => {
  const draft = seedMappingDrafts.find(({ messageType }) => messageType === 'INVOIC')!
  const transforms = [...draft.transforms]
  const transformLinks = [...draft.transformLinks]

  it('saves the links and transforms and returns the Draft', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [draft] }))

    const graph = { links: draft.links.slice(1), transforms, transformLinks }

    await expect(saveMappingDraft(draft.id, graph)).resolves.toMatchObject(graph)
  })

  it('rejects with 422 when a link ends at a part that holds others', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [draft] }))

    await expect(
      saveMappingDraft(draft.id, {
        links: [{ sourcePath: 'invoiceNumber', targetPath: 'BGM' }],
        transforms,
        transformLinks,
      }),
    ).rejects.toMatchObject({ status: 422 })
  })
})

describe('listLookupTables', () => {
  it('lists the Lookup Tables with their scope, sorted by name', async () => {
    server.use(lookupTablesHandler(apiUrl))

    const tables = await listLookupTables()

    expect(tables).toHaveLength(seedLookupTables.length)
    expect(tables[0]).toMatchObject({ name: 'Alpenfrisch article groups' })
    expect(tables.find(({ name }) => name === 'Country codes')?.scope).toEqual({
      kind: 'workspace',
    })
  })
})
