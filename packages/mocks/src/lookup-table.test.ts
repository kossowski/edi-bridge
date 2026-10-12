import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  createLookupTableEndpoint,
  deleteLookupTableEndpoint,
  importLookupTableEndpoint,
  type LookupTableImportBody,
  type LookupTableInput,
  lookupTableImportPreviewEndpoint,
  lookupTableEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSchema,
  lookupTablesEndpoint,
  lookupTableSuggestionsEndpoint,
  mappingsEndpoint,
  runDetailSchema,
  type RunSummary,
  runEndpoint,
  toPath,
  toSearchParams,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'

import { seedFlows } from './flow'
import {
  createLookupTables,
  lookupTableHandlers,
  partnerScope,
  seedLookupTableNamed,
  seedLookupTables,
} from './lookup-table'
import { mappingHandlers } from './mapping'
import { createRun } from './run'
import { runDetailHandlers } from './run-detail'
import { seedTradingPartners } from './trading-partner'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function send(method: string, path: string, body?: LookupTableInput | LookupTableImportBody) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })
}

const hansemarkt = seedTradingPartners[0]!

const input: LookupTableInput = {
  name: 'Packaging types',
  kind: 'other',
  scope: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id },
  entries: [{ sourceCode: 'KAR', targetCode: 'CT' }],
}

async function getLookupTable(id: string) {
  const response = await send('GET', toPath(lookupTableEndpoint.path, { id }))

  return lookupTableEndpoint.response.parse(await response.json())
}

async function listLookupTables() {
  const response = await send('GET', lookupTablesEndpoint.path)

  return lookupTablesEndpoint.response.parse(await response.json())
}

describe('lookupTableHandlers', () => {
  it('serves a seed Lookup Table with its entries', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const table = await getLookupTable(units.id)

    expect(table.entries).toContainEqual({ sourceCode: 'ST', targetCode: 'PCE' })
    expect(table.entryCount).toBe(table.entries.length)
    expect((await listLookupTables()).find(({ id }) => id === units.id)?.entryCount).toBe(
      table.entries.length,
    )
  })

  it('creates a Lookup Table for a Trading Partner and lists it', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    const response = await send('POST', createLookupTableEndpoint.path, input)
    const created = lookupTableSchema.parse(await response.json())

    expect(response.status).toBe(201)
    expect(created).toMatchObject({
      name: 'Packaging types',
      kind: 'other',
      scope: {
        kind: 'tradingPartner',
        tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt GmbH' },
      },
      entries: [{ sourceCode: 'KAR', targetCode: 'CT' }],
      entryCount: 1,
    })
    expect(await getLookupTable(created.id)).toEqual(created)
    expect(await listLookupTables()).toEqual([
      {
        id: created.id,
        name: created.name,
        kind: 'other',
        scope: created.scope,
        entryCount: 1,
        uses: [],
        missingCodeCounts: { blocking: 0, upcoming: 0 },
        updatedAt: created.updatedAt,
      },
    ])
  })

  it('rejects a Trading Partner that does not exist', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    const response = await send('POST', createLookupTableEndpoint.path, {
      ...input,
      scope: { kind: 'tradingPartner', tradingPartnerId: '10000000-0000-4000-8000-000000000099' },
    })

    expect(response.status).toBe(422)
  })

  it('rejects a name that another Lookup Table of the same scope uses', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const sameScope = await send('POST', createLookupTableEndpoint.path, {
      ...input,
      name: 'hansemarkt UNITS',
    })

    const otherScope = await send('POST', createLookupTableEndpoint.path, {
      ...input,
      name: 'Hansemarkt units',
      scope: { kind: 'workspace' },
    })

    expect(sameScope.status).toBe(409)
    expect(otherScope.status).toBe(201)
  })

  it('rejects repeated source codes', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    const response = await send('POST', createLookupTableEndpoint.path, {
      ...input,
      entries: [
        { sourceCode: 'KAR', targetCode: 'CT' },
        { sourceCode: 'KAR', targetCode: 'BX' },
      ],
    })

    expect(response.status).toBe(400)
  })

  it('replaces name, scope and entries as a whole on update', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')
    const path = toPath(updateLookupTableEndpoint.path, { id: units.id })

    const response = await send('PUT', path, input)

    expect(response.status).toBe(200)
    expect(await getLookupTable(units.id)).toMatchObject({
      id: units.id,
      name: 'Packaging types',
      scope: { kind: 'tradingPartner', tradingPartner: { id: hansemarkt.id } },
      entries: [{ sourceCode: 'KAR', targetCode: 'CT' }],
      entryCount: 1,
    })
  })

  it('records when a Lookup Table was last changed', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')
    const before = Date.now()

    await send('PUT', toPath(updateLookupTableEndpoint.path, { id: units.id }), {
      name: units.name,
      kind: units.kind,
      scope: { kind: 'workspace' },
      entries: [],
    })

    const { updatedAt } = await getLookupTable(units.id)

    expect(Date.parse(updatedAt)).toBeGreaterThanOrEqual(before)
  })

  it('lets a Lookup Table keep its own name on update', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const response = await send('PUT', toPath(updateLookupTableEndpoint.path, { id: units.id }), {
      name: 'Units of measure',
      kind: 'units',
      scope: { kind: 'workspace' },
      entries: [],
    })

    expect(response.status).toBe(200)
  })

  it('deletes a Lookup Table', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')
    const path = toPath(deleteLookupTableEndpoint.path, { id: units.id })

    const response = await send('DELETE', path)

    expect(response.status).toBe(204)
    expect((await send('GET', path)).status).toBe(404)
    expect((await listLookupTables()).map(({ id }) => id)).not.toContain(units.id)
  })

  it.each([
    ['GET', lookupTableEndpoint.path, undefined],
    ['PUT', updateLookupTableEndpoint.path, input],
    ['DELETE', deleteLookupTableEndpoint.path, undefined],
  ])('answers %s with 404 for an unknown Lookup Table', async (method, path, body) => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    const response = await send(method, toPath(path, { id: seedLookupTables[0]!.id }), body)

    expect(response.status).toBe(404)
  })
})

describe('createLookupTables', () => {
  it('generates a Lookup Table with a large volume of entries', async () => {
    const [large] = createLookupTables({ count: 1, entryCount: 5000 })
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [large!] }))

    const table = await getLookupTable(large!.id)

    expect(table.entryCount).toBe(5000)
    expect(new Set(table.entries.map(({ sourceCode }) => sourceCode)).size).toBe(5000)
  })

  it('generates the same Lookup Tables for the same seed', () => {
    const now = new Date('2026-10-09T12:00:00.000Z')

    expect(createLookupTables({ count: 3, now, seed: 1 })).toEqual(
      createLookupTables({ count: 3, now, seed: 1 }),
    )
  })
})

describe('POST /lookup-tables/:id/import-preview', () => {
  async function previewImport(id: string, csv: string) {
    const response = await send('POST', toPath(lookupTableImportPreviewEndpoint.path, { id }), {
      csv,
    })

    return lookupTableImportPreviewEndpoint.response.parse(await response.json())
  }

  it('classifies each row against the entries without applying them', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const csv = [
      'Source code;Target code',
      'ST;PCE',
      'KG;KGS',
      'KAR;CT',
      '',
      ';BX',
      'KAR;BX',
      '"Paket; groß";PK',
      'X;Y;Z',
      'L;',
    ].join('\r\n')

    const { rows } = await previewImport(units.id, csv)

    expect(rows).toEqual([
      { line: 2, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
      {
        line: 3,
        status: 'changed',
        sourceCode: 'KG',
        targetCode: 'KGS',
        previousTargetCode: 'KGM',
      },
      { line: 4, status: 'added', sourceCode: 'KAR', targetCode: 'CT' },
      { line: 6, status: 'invalid', cells: ['', 'BX'], reasons: ['sourceCodeMissing'] },
      { line: 7, status: 'invalid', cells: ['KAR', 'BX'], reasons: ['duplicateSourceCode'] },
      { line: 8, status: 'added', sourceCode: 'Paket; groß', targetCode: 'PK' },
      { line: 9, status: 'invalid', cells: ['X', 'Y', 'Z'], reasons: ['columnCount'] },
      { line: 10, status: 'invalid', cells: ['L', ''], reasons: ['targetCodeMissing'] },
    ])
    expect((await getLookupTable(units.id)).entries).toEqual(units.entries)
  })

  it('reads comma-separated rows without a header', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const { rows } = await previewImport(units.id, 'STK,PCE\n"BX ""large""",BX\n')

    expect(rows).toEqual([
      { line: 1, status: 'unchanged', sourceCode: 'STK', targetCode: 'PCE' },
      { line: 2, status: 'added', sourceCode: 'BX "large"', targetCode: 'BX' },
    ])
  })

  it('matches the first row of a file that starts with a byte order mark', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const { rows } = await previewImport(units.id, '﻿ST;PCE\r\nKG;KGM')

    expect(rows).toEqual([
      { line: 1, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
      { line: 2, status: 'unchanged', sourceCode: 'KG', targetCode: 'KGM' },
    ])
  })

  it('rejects codes longer than the limit', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')
    const long = 'X'.repeat(71)

    const { rows } = await previewImport(units.id, `${long};${long}`)

    expect(rows).toEqual([
      {
        line: 1,
        status: 'invalid',
        cells: [long, long],
        reasons: ['sourceCodeTooLong', 'targetCodeTooLong'],
      },
    ])
  })

  it('answers 404 for an unknown Lookup Table', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))

    const response = await send(
      'POST',
      toPath(lookupTableImportPreviewEndpoint.path, { id: seedLookupTables[0]!.id }),
      { csv: 'ST;PCE' },
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /lookup-tables/:id/import', () => {
  it('adds and changes the valid rows and keeps the other entries', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')
    const path = toPath(importLookupTableEndpoint.path, { id: units.id })

    const response = await send('POST', path, { csv: 'KG;KGS\nKAR;CT\n;BX\nST;PCE' })
    const imported = importLookupTableEndpoint.response.parse(await response.json())

    expect(imported.entries).toEqual([
      { sourceCode: 'ST', targetCode: 'PCE' },
      { sourceCode: 'STK', targetCode: 'PCE' },
      { sourceCode: 'KG', targetCode: 'KGS' },
      { sourceCode: 'L', targetCode: 'LTR' },
      { sourceCode: 'KAR', targetCode: 'CT' },
    ])
    expect(imported.updatedAt).not.toBe(units.updatedAt)
    expect(await getLookupTable(units.id)).toEqual(imported)
  })

  it('answers 404 for an unknown Lookup Table', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))
    const path = toPath(importLookupTableEndpoint.path, { id: seedLookupTables[0]!.id })

    expect((await send('POST', path, { csv: 'ST;PCE' })).status).toBe(404)
  })
})

const hansemarktOrdersFlow = seedFlows.find(
  ({ tradingPartnerId, messageType }) =>
    tradingPartnerId === hansemarkt.id && messageType === 'ORDERS',
)!

function failedOrders(id: string, receivedAt: string): RunSummary {
  return createRun({
    id,
    tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
    messageType: 'ORDERS',
    direction: 'inbound',
    flow: { id: hansemarktOrdersFlow.id, name: hansemarktOrdersFlow.name },
    receivedAt,
    status: 'failed',
    failureStage: 'mapping',
  })
}

const olderFailure = failedOrders(
  '00000000-0000-4000-8000-000000000001',
  '2026-10-01T08:00:00.000Z',
)

const newerFailure = failedOrders(
  '00000000-0000-4000-8000-000000000002',
  '2026-10-03T08:00:00.000Z',
)

async function getMissingCodes(id: string) {
  const response = await send('GET', toPath(lookupTableMissingCodesEndpoint.path, { id }))

  return lookupTableMissingCodesEndpoint.response.parse(await response.json())
}

describe('GET /lookup-tables/:id/missing-codes', () => {
  it('lists a code that made documents fail as blocking, newest failure first', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [olderFailure, newerFailure] }))
    const units = seedLookupTableNamed('Units of measure')

    const [krt] = await getMissingCodes(units.id)

    expect(krt).toEqual({
      urgency: 'blocking',
      code: 'KRT',
      meaning: 'carton',
      suggestions: [
        { code: 'CT', meaning: 'Carton' },
        { code: 'PK', meaning: 'Package' },
        { code: 'BX', meaning: 'Box' },
      ],
      failedRuns: [
        {
          id: newerFailure.id,
          receivedAt: newerFailure.receivedAt,
          tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
          messageType: 'ORDERS',
          businessReference: newerFailure.businessReference,
        },
        expect.objectContaining({ id: olderFailure.id }),
      ],
    })
  })

  it('points the blocking code at a Run whose problem names the same table and code', async () => {
    const runs = [newerFailure]
    server.use(...lookupTableHandlers(apiUrl, { runs }), ...runDetailHandlers(apiUrl, { runs }))
    const units = seedLookupTableNamed('Units of measure')

    const [krt] = await getMissingCodes(units.id)
    const runId = krt?.urgency === 'blocking' ? krt.failedRuns[0]!.id : ''

    const run = runDetailSchema.parse(
      await (await send('GET', toPath(runEndpoint.path, { id: runId }))).json(),
    )

    expect(run.problem?.fixTarget).toEqual({
      kind: 'lookupTable',
      lookupTableId: units.id,
      name: 'Units of measure',
      code: 'KRT',
    })
  })

  it('lists codes from your data that no document used yet after the blocking ones', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [newerFailure] }))
    const units = seedLookupTableNamed('Units of measure')

    const codes = await getMissingCodes(units.id)

    expect(codes.map(({ code, urgency }) => [code, urgency])).toEqual([
      ['KRT', 'blocking'],
      ['BTL', 'upcoming'],
      ['SET', 'upcoming'],
    ])
    expect(codes[1]).toMatchObject({ meaning: 'bottle', itemCount: 14 })
  })

  it('drops a code once the table translates it and counts the rest on the list', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [newerFailure] }))
    const units = seedLookupTableNamed('Units of measure')

    await send('PUT', toPath(updateLookupTableEndpoint.path, { id: units.id }), {
      name: units.name,
      kind: units.kind,
      scope: { kind: 'workspace' },
      entries: [...units.entries, { sourceCode: 'KRT', targetCode: 'CT' }],
    })

    expect((await getMissingCodes(units.id)).map(({ code }) => code)).toEqual(['BTL', 'SET'])
    expect((await listLookupTables()).find(({ id }) => id === units.id)?.missingCodeCounts).toEqual(
      { blocking: 0, upcoming: 2 },
    )
  })

  it('no longer blocks on a Run that was reprocessed', async () => {
    const replacing = createRun({ ...newerFailure, id: '00000000-0000-4000-8000-000000000003' })
    const runs = [newerFailure, { ...replacing, status: 'delivered', failureStage: null } as const]

    server.use(
      ...lookupTableHandlers(apiUrl, {
        runs,
        reprocessed: [{ replaced: newerFailure.id, replacing: replacing.id }],
      }),
    )

    const codes = await getMissingCodes(seedLookupTableNamed('Units of measure').id)

    expect(codes.map(({ urgency }) => urgency)).not.toContain('blocking')
  })

  it('answers with no codes for a table without traffic', async () => {
    server.use(...lookupTableHandlers(apiUrl, { runs: [] }))

    expect(await getMissingCodes(seedLookupTableNamed('VAT categories').id)).toEqual([])
  })

  it('serves a large volume of blocking and upcoming codes', async () => {
    const [large] = createLookupTables({ count: 1, blockingCodeCount: 200, upcomingCodeCount: 500 })
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [large!], runs: [] }))

    const codes = await getMissingCodes(large!.id)

    expect(codes.filter(({ urgency }) => urgency === 'blocking')).toHaveLength(200)
    expect(codes.filter(({ urgency }) => urgency === 'upcoming')).toHaveLength(500)
    expect((await listLookupTables())[0]?.missingCodeCounts).toEqual({
      blocking: 200,
      upcoming: 500,
    })
  })

  it('answers 404 for an unknown Lookup Table', async () => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: [] }))
    const path = toPath(lookupTableMissingCodesEndpoint.path, { id: seedLookupTables[0]!.id })

    expect((await send('GET', path)).status).toBe(404)
  })
})

describe('Lookup Table uses', () => {
  it('names the Mappings that use a table with the Trading Partners of their Flows', async () => {
    server.use(...lookupTableHandlers(apiUrl), ...mappingHandlers(apiUrl))
    const countries = seedLookupTableNamed('Country codes')

    const { uses } = await getLookupTable(countries.id)

    const mappings = mappingsEndpoint.response.parse(
      await (await send('GET', mappingsEndpoint.path)).json(),
    )

    expect(uses.length).toBeGreaterThan(0)

    for (const use of uses) {
      const mapping = mappings.find(({ id }) => id === use.mappingId)

      expect(use).toEqual({
        mappingId: mapping?.id,
        name: mapping?.name,
        messageType: 'ORDERS',
        direction: 'inbound',
        tradingPartners: mapping?.partners,
      })
    }
  })

  it('names the ORDERS Mappings that read the units the blocking KRT is missing from', async () => {
    server.use(...lookupTableHandlers(apiUrl))
    const units = seedLookupTableNamed('Units of measure')

    const { uses, missingCodeCounts } = await getLookupTable(units.id)

    expect(missingCodeCounts.blocking).toBe(1)
    expect(uses.length).toBeGreaterThan(0)
    expect(new Set(uses.map(({ messageType }) => messageType))).toEqual(new Set(['ORDERS']))
    expect(uses.every(({ tradingPartners }) => tradingPartners.length > 0)).toBe(true)
  })

  it('names only the Trading Partner a partner table belongs to', async () => {
    const countries = seedLookupTableNamed('Country codes')
    const lookupTables = [{ ...countries, scope: partnerScope(hansemarkt) }]
    server.use(...lookupTableHandlers(apiUrl, { lookupTables }))

    const { uses } = await getLookupTable(countries.id)

    expect(
      new Set(uses.flatMap(({ tradingPartners }) => tradingPartners.map(({ id }) => id))),
    ).toEqual(new Set([hansemarkt.id]))
  })

  it('lists no uses for a table that no Mapping reads', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    expect(
      (await getLookupTable(seedLookupTableNamed('Hansemarkt store numbers').id)).uses,
    ).toEqual([])
  })
})

describe('code meanings', () => {
  it('explains the target codes it knows for the kind of the table', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const { codeMeanings } = await getLookupTable(seedLookupTableNamed('Units of measure').id)

    expect(codeMeanings).toEqual([
      { code: 'PCE', meaning: 'Piece' },
      { code: 'KGM', meaning: 'Kilogram' },
      { code: 'LTR', meaning: 'Litre' },
    ])
  })
})

describe('GET /lookup-table-suggestions', () => {
  async function suggest(query: Record<string, string>) {
    return send('GET', `${lookupTableSuggestionsEndpoint.path}?${toSearchParams(query)}`)
  }

  it('suggests first values for a kind with the meaning of each code', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const response = await suggest({ kind: 'units', tradingPartnerId: hansemarkt.id })
    const { entries } = lookupTableSuggestionsEndpoint.response.parse(await response.json())

    expect(entries[0]).toEqual({ sourceCode: 'ST', targetCode: 'PCE', targetMeaning: 'Piece' })
    expect(entries.map(({ sourceCode }) => sourceCode)).toEqual(['ST', 'KRT', 'KG', 'PAL'])
  })

  it('suggests nothing for a kind without a known code list', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    const response = await suggest({ kind: 'other' })

    expect(await response.json()).toEqual({ entries: [] })
  })

  it('rejects an unknown kind and an unknown Trading Partner', async () => {
    server.use(...lookupTableHandlers(apiUrl))

    expect((await suggest({ kind: 'vatCodes' })).status).toBe(400)
    expect(
      (await suggest({ kind: 'units', tradingPartnerId: '10000000-0000-4000-8000-000000000099' }))
        .status,
    ).toBe(422)
  })
})

describe('lookupTableHandlers states', () => {
  it.each([
    ['GET', lookupTablesEndpoint.path],
    ['GET', toPath(lookupTableEndpoint.path, { id: seedLookupTables[0]!.id })],
    ['GET', toPath(lookupTableMissingCodesEndpoint.path, { id: seedLookupTables[0]!.id })],
    ['GET', `${lookupTableSuggestionsEndpoint.path}?kind=units`],
  ])('answers %s %s with a server error in the error state', async (method, path) => {
    server.use(...lookupTableHandlers(apiUrl, { lookupTables: 'error' }))

    expect((await send(method, path)).status).toBe(500)
  })
})
