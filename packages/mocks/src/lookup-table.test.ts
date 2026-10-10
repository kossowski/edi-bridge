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
  lookupTableSchema,
  lookupTablesEndpoint,
  toPath,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'

import {
  createLookupTables,
  lookupTableHandlers,
  seedLookupTableNamed,
  seedLookupTables,
} from './lookup-table'
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
        scope: created.scope,
        entryCount: 1,
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
