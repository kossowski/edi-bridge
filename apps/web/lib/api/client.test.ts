import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  type CharacterEncoding,
  documentStructureOrigins,
  encodeBase64,
  mappingVersionSummarySchema,
  submitDocumentEndpoint,
} from '@edi-bridge/contracts'
import {
  aiDraftHandlers,
  aiProposalFor,
  channelHandlers,
  createRun,
  createTradingPartner as buildTradingPartner,
  createWorkspace,
  documentStructureHandlers,
  lookupTableHandlers,
  lookupTableListHandler,
  manualSubmissionHandler,
  mappingHandlers,
  mappingVersionHandlers,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedMappingDrafts,
  seedMappingSamples,
  seedUnusedDocumentStructures,
  runDetailHandlers,
  runsHandler,
  seedChannels,
  seedLookupTableNamed,
  seedLookupTables,
  seedTradingPartners,
  tradingPartnerHandlers,
  withAiProposal,
  workspaceHandlers,
} from '@edi-bridge/mocks'

import {
  acceptAiProposedParts,
  aiBudgetExhaustedProblemOf,
  ApiError,
  createChannel,
  createLookupTable,
  createMapping,
  createTradingPartner,
  deleteLookupTable,
  documentStructureProblemOf,
  documentUndecodableOf,
  getChannel,
  getLookupTable,
  getLookupTableSuggestions,
  inferDocumentStructure,
  getRun,
  importLookupTable,
  hintLookupTableMissingCodes,
  listLookupTableMissingCodes,
  listLookupTables,
  listMappingVersions,
  listRuns,
  previewLookupTableImport,
  publishMappingDraft,
  regenerateWebhookToken,
  reprocessRun,
  retriesQuery,
  retryRun,
  saveMappingDraft,
  sendTestInterchange,
  submitDocument,
  switchToProduction,
  testInterchangeRefusalOf,
  updateCompanyIdentity,
  updateDocumentStructure,
  updateLookupTable,
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

  it('retries a delivery failure and gets the Run back received for its delivery', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [deliveryFailure] }))

    const run = await retryRun(deliveryFailure.id)

    expect(run).toMatchObject({ id: deliveryFailure.id, status: 'received', failureStage: null })
  })

  it('reprocesses a mapping failure with the chosen Mapping Version', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [mappingFailure] }))
    const { mappingVersion } = await getRun(mappingFailure.id)
    const versions = await listMappingVersions(mappingVersion!.mappingId)

    const run = await reprocessRun(mappingFailure.id, { mappingVersionId: versions.at(-1)!.id })

    expect(run.replaces).toEqual({ id: mappingFailure.id })
    expect(run.mappingVersion).toEqual(mappingVersionSummarySchema.parse(versions.at(-1)))
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
      testRejectedAt: null,
      testRejectedRunId: null,
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

  it('reads why a test send was refused', async () => {
    const flow = { id: '00000000-0000-4000-8000-0000000000f1', name: 'Invoices to Kieler Kontor' }

    const notStarted = {
      ...existing,
      onboarding: {
        testInterchangeSentAt: null,
        contrlReceivedAt: null,
        testRejectedAt: null,
        testRejectedRunId: null,
      },
    }

    server.use(
      ...tradingPartnerHandlers(apiUrl, {
        tradingPartners: [notStarted],
        testInterchange: { refusal: { reason: 'sampleMissing', flow } },
      }),
    )

    const error = await sendTestInterchange(notStarted.id).then(
      () => null,
      (failure: Error) => failure,
    )

    expect(testInterchangeRefusalOf(error)).toEqual({ reason: 'sampleMissing', flow })
  })

  it('has no refusal for other failures of the test send', async () => {
    server.use(...tradingPartnerHandlers(apiUrl, { tradingPartners: [] }))

    const error = await sendTestInterchange(existing.id).then(
      () => null,
      (failure: Error) => failure,
    )

    expect(error).toMatchObject({ status: 404 })
    expect(testInterchangeRefusalOf(error)).toBeNull()
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

describe('createMapping', () => {
  it('creates a never-published Mapping for the Message Type', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [...seedMappingDrafts] }))

    await expect(
      createMapping({
        messageType: 'ORDERS',
        documentStructureId: seedDocumentStructureOf.ORDERS.id,
      }),
    ).resolves.toMatchObject({
      direction: 'inbound',
      messageType: 'ORDERS',
      documentStructureId: seedDocumentStructureOf.ORDERS.id,
      latestVersion: null,
      unpublishedChanges: true,
    })
  })

  it('rejects with 422 for a Document Structure the Workspace does not have', async () => {
    server.use(...mappingHandlers(apiUrl, { mappings: [], documentStructures: [] }))

    await expect(
      createMapping({
        messageType: 'INVOIC',
        documentStructureId: seedDocumentStructureOf.INVOIC.id,
      }),
    ).rejects.toMatchObject({ status: 422 })
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

describe('acceptAiProposedParts', () => {
  const record = seedMappingDrafts.find(
    ({ id, links }) =>
      links.length === 0 && seedMappingSamples.some(({ mappingId }) => mappingId === id),
  )!

  const sample = seedMappingSamples.find(({ mappingId }) => mappingId === record.id)!
  const reviewed = withAiProposal(record, sample.id, aiProposalFor(record, seedDocumentStructures))
  const review = reviewed.aiReview!

  it('drops the marks of the accepted parts and returns the Draft', async () => {
    server.use(...aiDraftHandlers(apiUrl, { mappings: [reviewed] }))

    const [first, ...others] = review.proposedLinks

    await expect(
      acceptAiProposedParts(reviewed.id, { links: [first!], transforms: [], transformLinks: [] }),
    ).resolves.toMatchObject({ aiReview: { ...review, proposedLinks: others } })
  })

  it('rejects with 409 for a part the AI review does not mark', async () => {
    server.use(...aiDraftHandlers(apiUrl, { mappings: [reviewed] }))

    await expect(
      acceptAiProposedParts(reviewed.id, {
        links: ['UNH/0062'],
        transforms: [],
        transformLinks: [],
      }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('publishMappingDraft', () => {
  const unchanged = seedMappingDrafts.find(
    ({ unpublishedChanges, links }) => !unpublishedChanges && links.length === 0,
  )!

  it('publishes the Draft as the next Mapping Version', async () => {
    const changed = { ...unchanged, unpublishedChanges: true }

    server.use(...mappingVersionHandlers(apiUrl, { mappings: [changed] }))

    await expect(
      publishMappingDraft(changed.id, { changeNote: 'Delivery date added', moveFlowIds: [] }),
    ).resolves.toMatchObject({
      mappingId: changed.id,
      version: changed.latestVersion! + 1,
    })
  })

  it('rejects with 409 when the Draft has no changes since its latest version', async () => {
    server.use(...mappingVersionHandlers(apiUrl, { mappings: [unchanged] }))

    await expect(
      publishMappingDraft(unchanged.id, { changeNote: '', moveFlowIds: [] }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('listLookupTables', () => {
  it('lists the Lookup Tables with their scope, sorted by name', async () => {
    server.use(lookupTableListHandler(apiUrl))

    const tables = await listLookupTables()

    expect(tables).toHaveLength(seedLookupTables.length)
    expect(tables[0]).toMatchObject({ name: 'Alpenfrisch article groups' })
    expect(tables.find(({ name }) => name === 'Country codes')?.scope).toEqual({
      kind: 'workspace',
    })
  })
})

describe('Document Structure problems', () => {
  const [csv] = seedUnusedDocumentStructures

  async function problemOf(attempt: Promise<unknown>) {
    const error = await attempt.then(
      () => null,
      (failure: Error) => failure,
    )

    return documentStructureProblemOf(error)
  }

  it('reads the problem of a refused adjustment', async () => {
    server.use(...documentStructureHandlers(apiUrl, { documentStructures: [csv!] }))

    const problem = await problemOf(
      updateDocumentStructure(csv!.id, {
        name: csv!.name,
        adjustments: [{ path: 'rows[]', required: false }],
      }),
    )

    expect(problem).toMatchObject({ code: 'notAdjustable', path: 'rows[]' })
  })

  it('reads the problem of a file that cannot be inferred', async () => {
    server.use(...documentStructureHandlers(apiUrl))

    const problem = await problemOf(
      inferDocumentStructure(documentStructureOrigins.invalidJsonDocument),
    )

    expect(problem).toMatchObject({ code: 'invalidJson' })
  })

  it('has no problem for other failures', async () => {
    server.use(...documentStructureHandlers(apiUrl, { documentStructures: [] }))

    await expect(
      problemOf(updateDocumentStructure(csv!.id, { name: 'x', adjustments: [] })),
    ).resolves.toBeNull()
  })

  it('reads a problem only from a refusal', async () => {
    const body = {
      code: 'notAdjustable',
      message: 'x',
      path: null,
      line: null,
      mappingVersions: null,
    }

    server.use(
      http.put(`${apiUrl}/document-structures/${csv!.id}`, () =>
        HttpResponse.json(body, { status: 500 }),
      ),
    )

    const error = await updateDocumentStructure(csv!.id, { name: 'x', adjustments: [] }).then(
      () => null,
      (failure: Error) => failure,
    )

    expect(error instanceof ApiError && JSON.parse(error.body)).toEqual(body)
    expect(documentStructureProblemOf(error)).toBeNull()
  })
})

describe('Lookup Table actions', () => {
  const units = seedLookupTableNamed('Units of measure')
  const hansemarkt = seedTradingPartners[0]!

  it('creates an empty Lookup Table for a Trading Partner', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const created = await createLookupTable({
      name: 'Packaging types',
      kind: 'other',
      scope: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id },
      entries: [],
    })

    expect(created).toMatchObject({
      name: 'Packaging types',
      scope: { kind: 'tradingPartner', tradingPartner: { name: hansemarkt.name } },
      entryCount: 0,
    })
  })

  it('renames a Lookup Table and keeps its entries', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const { entries } = await getLookupTable(units.id, 'en')

    await expect(
      updateLookupTable(units.id, {
        name: 'Units',
        kind: 'units',
        scope: { kind: 'workspace' },
        entries,
      }),
    ).resolves.toMatchObject({ name: 'Units', entries: units.entries })
  })

  it('reads the code meanings of a Lookup Table in the page language', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const { codeMeanings } = await getLookupTable(units.id, 'de')

    expect(codeMeanings).toContainEqual({ code: 'PCE', meaning: 'Stück' })
  })

  it('reads the meanings of missing codes in the page language', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [] }))

    const codes = await listLookupTableMissingCodes(units.id, 'de')

    expect(codes.find(({ code }) => code === 'SET')?.meaning).toBe('Satz')
  })

  it('asks the AI to explain the missing codes in the page language', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [] }))

    const { hints, notice } = await hintLookupTableMissingCodes(units.id, 'de')

    expect(hints.find(({ code }) => code === 'BTL')?.meaning).toBe('Flasche')
    expect(notice).toBeNull()
  })

  it('explains the missing codes without AI when the AI budget is used up', async () => {
    server.use(
      ...lookupTableHandlers(apiUrl, { runs: [], missingCodeHintsNotice: 'aiBudgetExhausted' }),
    )

    const { notice } = await hintLookupTableMissingCodes(units.id, 'en')

    expect(notice?.reason).toBe('aiBudgetExhausted')
  })

  it('reads the meanings of suggested values in the page language', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const { entries } = await getLookupTableSuggestions({ kind: 'countries', language: 'de' })

    expect(entries[0]?.targetMeaning).toBe('Deutschland')
  })

  it('rejects suggested values with the budget when the AI budget is used up', async () => {
    server.use(...lookupTableHandlers(apiUrl, { suggestions: 'aiBudgetExhausted' }))

    const error = await getLookupTableSuggestions({ kind: 'units', language: 'en' }).then(
      () => null,
      (caught: Error) => caught,
    )

    expect(aiBudgetExhaustedProblemOf(error)).toMatchObject({ code: 'aiBudgetExhausted' })
  })

  it('lists the codes a Lookup Table is missing', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [] }))

    const codes = await listLookupTableMissingCodes(units.id, 'en')

    expect(codes.map(({ code, urgency }) => [code, urgency])).toEqual([
      ['BTL', 'upcoming'],
      ['SET', 'upcoming'],
    ])
  })

  it('asks for suggested first values of a kind for one Trading Partner', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const { entries } = await getLookupTableSuggestions({
      kind: 'countries',
      tradingPartnerId: hansemarkt.id,
      language: 'en',
    })

    expect(entries[0]).toEqual({
      sourceCode: 'Deutschland',
      targetCode: 'DE',
      targetMeaning: 'Germany',
    })
  })

  it('deletes a Lookup Table from a response without a body', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const storeNumbers = seedLookupTableNamed('Hansemarkt store numbers')

    await expect(deleteLookupTable(storeNumbers.id)).resolves.toBeUndefined()
    await expect(getLookupTable(storeNumbers.id, 'en')).rejects.toMatchObject({ status: 404 })
  })
})

describe('Lookup Table CSV import', () => {
  const units = seedLookupTableNamed('Units of measure')
  const csv = 'source;target\nST;PCE\nKG;KGS\nMTR;MTR\n;LTR'

  it('previews the import without applying it', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const { rows } = await previewLookupTableImport(units.id, { csv })

    expect(rows.map(({ status }) => status)).toEqual(['unchanged', 'changed', 'added', 'invalid'])
    await expect(getLookupTable(units.id, 'en')).resolves.toMatchObject({ entries: units.entries })
  })

  it('merges the imported entries and keeps entries missing from the CSV', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const imported = await importLookupTable(units.id, { csv })

    expect(imported.entries).toEqual([
      { sourceCode: 'ST', targetCode: 'PCE' },
      { sourceCode: 'STK', targetCode: 'PCE' },
      { sourceCode: 'KG', targetCode: 'KGS' },
      { sourceCode: 'L', targetCode: 'LTR' },
      { sourceCode: 'MTR', targetCode: 'MTR' },
    ])
  })

  it('rejects a preview for an unknown Lookup Table', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    await expect(
      previewLookupTableImport('00000000-0000-4000-8000-0000000000ff', { csv }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('retriesQuery', () => {
  it.each([400, 401, 403, 404, 409, 422])('gives up at once on a %i answer', (status) => {
    expect(retriesQuery(0, new ApiError(status, '/trading-partners/1'))).toBe(false)
  })

  it.each([408, 429, 500, 502, 503])('tries a %i answer three times more', (status) => {
    const error = new ApiError(status, '/trading-partners/1')

    expect([0, 1, 2, 3].map((failureCount) => retriesQuery(failureCount, error))).toEqual([
      true,
      true,
      true,
      false,
    ])
  })

  it('tries again when the request did not reach the api', () => {
    expect(retriesQuery(0, new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('Manual Submission refusals', () => {
  const erpWebhook = seedChannels.find(({ name }) => name === 'ERP webhook')!

  // "Käufer" in Windows-1252: the ä is the byte E4, which UTF-8 never holds alone.
  const windows1252 = new Uint8Array([0x4b, 0xe4, 0x75, 0x66, 0x65, 0x72, 0x0a])

  const submitted = (encoding?: CharacterEncoding) =>
    submitDocument({
      channelId: erpWebhook.id,
      document: { fileName: 'dispatch.csv', content: encodeBase64(windows1252), encoding },
    }).then(
      () => null,
      (failure: Error) => failure,
    )

  it('reads the refusal of a Document not valid in its encoding', async () => {
    server.use(manualSubmissionHandler(apiUrl))

    const problem = documentUndecodableOf(await submitted('utf-8'))

    expect(problem).toMatchObject({ code: 'documentUndecodable', encoding: 'utf-8' })
    expect(problem?.message).toContain('Windows-1252')
  })

  it('has no refusal for another unprocessable submission', async () => {
    server.use(
      http.post(`${apiUrl}${submitDocumentEndpoint.path}`, () =>
        HttpResponse.json(
          { message: 'No Flow routes Documents from this Channel' },
          { status: 422 },
        ),
      ),
    )

    const error = await submitted('windows-1252')

    expect(error).toMatchObject({ status: 422 })
    expect(documentUndecodableOf(error)).toBeNull()
  })
})
