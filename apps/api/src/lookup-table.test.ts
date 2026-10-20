import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import {
  createLookupTableEndpoint,
  createTradingPartnerEndpoint,
  deleteLookupTableEndpoint,
  importLookupTableEndpoint,
  type LookupTable,
  type LookupTableInput,
  lookupTableEndpoint,
  lookupTableImportPreviewEndpoint,
  lookupTableImportPreviewSchema,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTableSchema,
  lookupTablesEndpoint,
  maxLookupTableCsvLength,
  lookupTableSummarySchema,
  tradingPartnerSchema,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'
import { connect, type Connection, lookupTables, tradingPartners } from '@edi-bridge/db'

import { buildApp } from './app.js'
import {
  type Client,
  ownAdmin,
  signIn,
  startTestApi,
  type TestApi,
  testAuth,
  testChannels,
  testRunQueue,
} from './testing.js'
import { memoryWebhookRateLimiter } from './webhook-rate-limit.js'

import type { Transaction } from './db.js'

type LookupTableBody = Omit<LookupTableInput, 'kind'> & { kind: string }

const units: LookupTableInput = {
  name: 'Mengeneinheiten',
  kind: 'units',
  scope: { kind: 'workspace' },
  entries: [
    { sourceCode: 'ST', targetCode: 'PCE' },
    { sourceCode: 'KAR', targetCode: 'CT' },
  ],
}

const up = () => Promise.resolve()

let api: TestApi

let connection: Connection

let admin: Client

let otherAdmin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, otherAdmin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(lookupTables)
  await connection.db.delete(tradingPartners)
})

const post = (body: LookupTableBody, target = admin) =>
  target.inject({ method: 'POST', url: createLookupTableEndpoint.path, body })

const get = (id: string, target = admin) =>
  target.inject({ method: 'GET', url: lookupTableEndpoint.path.replace(':id', id) })

const posted = async (body: LookupTableBody, target = admin) =>
  lookupTableSchema.parse((await post(body, target)).json())

const update = (id: string, body: LookupTableBody, target = admin) =>
  target.inject({ method: 'PUT', url: updateLookupTableEndpoint.path.replace(':id', id), body })

const remove = (id: string, target = admin) =>
  target.inject({ method: 'DELETE', url: deleteLookupTableEndpoint.path.replace(':id', id) })

const list = (target = admin) => target.inject({ method: 'GET', url: lookupTablesEndpoint.path })

const summaryOf = (table: LookupTable) => lookupTableSummarySchema.parse(table)

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const postTradingPartner = async (name: string, target = admin) =>
  tradingPartnerSchema.parse(
    (
      await target.inject({
        method: 'POST',
        url: createTradingPartnerEndpoint.path,
        body: { name, gln: null, characterSet: 'UNOC', acknowledgementTimeLimitHours: 24 },
      })
    ).json(),
  )

const unused = {
  uses: [],
  missingCodeCounts: { blocking: 0, upcoming: 0 },
  blockingCodes: [],
}

describe('POST /lookup-tables', () => {
  it('creates a Lookup Table of the Workspace with its entries in order', async () => {
    const response = await post(units)

    expect(response.statusCode).toBe(201)

    const created = lookupTableSchema.parse(response.json())

    expect(created).toEqual({
      ...units,
      ...unused,
      codeMeanings: [
        { code: 'PCE', meaning: 'Piece' },
        { code: 'CT', meaning: 'Carton' },
      ],
      id: created.id,
      entryCount: 2,
      updatedAt: created.updatedAt,
    })

    const read = await get(created.id)

    expect(read.statusCode).toBe(200)
    expect(lookupTableSchema.parse(read.json())).toEqual(created)
  })
})

describe('POST /lookup-tables with a Trading Partner scope', () => {
  it('creates a Lookup Table of the Trading Partner', async () => {
    const hansemarkt = await postTradingPartner('Hansemarkt GmbH')

    const response = await post({
      ...units,
      scope: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      scope: {
        kind: 'tradingPartner',
        tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt GmbH' },
      },
    })
  })

  it.each([
    ['an unknown Trading Partner', () => Promise.resolve(unknownId)],
    [
      'a Trading Partner of another Workspace',
      async () => (await postTradingPartner('Elbtal Warenhaus KG', otherAdmin)).id,
    ],
  ])('answers 422 for %s', async (_case, tradingPartnerId) => {
    const response = await post({
      ...units,
      scope: { kind: 'tradingPartner', tradingPartnerId: await tradingPartnerId() },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'Unknown Trading Partner' })
  })
})

describe('the name of a Lookup Table', () => {
  const nameConflict = { message: 'Another Lookup Table of this scope already uses this name' }

  it('is unique within the Workspace scope, ignoring case', async () => {
    await post(units)

    const response = await post({ ...units, name: 'MENGENEINHEITEN', kind: 'other' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(nameConflict)
  })

  it('is unique within a Trading Partner scope', async () => {
    const hansemarkt = await postTradingPartner('Hansemarkt GmbH')
    const scope = { kind: 'tradingPartner' as const, tradingPartnerId: hansemarkt.id }
    await post({ ...units, scope })

    const response = await post({ ...units, scope })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(nameConflict)
  })

  it('may repeat in another scope or Workspace', async () => {
    const hansemarkt = await postTradingPartner('Hansemarkt GmbH')
    const rheinkauf = await postTradingPartner('Rheinkauf eG')
    await post(units)

    const responses = [
      await post({ ...units, scope: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id } }),
      await post({ ...units, scope: { kind: 'tradingPartner', tradingPartnerId: rheinkauf.id } }),
      await post(units, otherAdmin),
    ]

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([201, 201, 201])
  })
})

describe('an invalid Lookup Table', () => {
  it.each([
    ['an empty name', { ...units, name: ' ' }],
    ['an unknown kind', { ...units, kind: 'currencies' }],
    [
      'a repeated source code',
      {
        ...units,
        entries: [
          { sourceCode: 'ST', targetCode: 'PCE' },
          { sourceCode: 'ST', targetCode: 'EA' },
        ],
      },
    ],
    [
      'a code above 70 characters',
      { ...units, entries: [{ sourceCode: 'X'.repeat(71), targetCode: 'PCE' }] },
    ],
  ])('is rejected for %s', async (_case, body) => {
    const response = await post(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')
  })
})

describe('GET /lookup-tables', () => {
  it('lists the Lookup Tables of the Workspace by name, without their entries', async () => {
    const customs = await posted({ ...units, name: 'Zollcodes' })
    const countries = await posted({ ...units, name: 'Ländercodes' })
    const addresses = await posted({ ...units, name: 'Adressen' })
    await post(units, otherAdmin)

    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(lookupTableSummarySchema.array().parse(response.json())).toEqual(
      [addresses, countries, customs].map(summaryOf),
    )
  })

  it('lists nothing for a Workspace without Lookup Tables', async () => {
    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})

describe('GET /lookup-tables/:id', () => {
  it('gives the meanings of the known target codes in the requested language', async () => {
    const { id } = await posted({
      ...units,
      entries: [...units.entries, { sourceCode: 'KRT', targetCode: 'KRT' }],
    })

    const response = await admin.inject({
      method: 'GET',
      url: lookupTableEndpoint.path.replace(':id', id),
      query: { language: 'de' },
    })

    expect(response.statusCode).toBe(200)
    expect(lookupTableSchema.parse(response.json()).codeMeanings).toEqual([
      { code: 'PCE', meaning: 'Stück' },
      { code: 'CT', meaning: 'Karton' },
    ])
  })

  it('answers 400 for an unknown language', async () => {
    const { id } = await posted(units)

    const response = await admin.inject({
      method: 'GET',
      url: lookupTableEndpoint.path.replace(':id', id),
      query: { language: 'fr' },
    })

    expect(response.statusCode).toBe(400)
  })

  it.each([
    ['an unknown id', () => Promise.resolve(unknownId)],
    ['an id that is no uuid', () => Promise.resolve('units')],
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherAdmin)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await get(await id())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })
})

describe('GET /lookup-tables/:id/missing-codes', () => {
  const missingCodes = (id: string, target = admin) =>
    target.inject({
      method: 'GET',
      url: lookupTableMissingCodesEndpoint.path.replace(':id', id),
    })

  it('lists no missing codes for a Lookup Table without failed Runs', async () => {
    const { id } = await posted(units)

    const response = await missingCodes(id)

    expect(response.statusCode).toBe(200)
    expect(lookupTableMissingCodesEndpoint.response.parse(response.json())).toEqual([])
  })

  it.each([
    ['an unknown id', () => Promise.resolve(unknownId)],
    ['an id that is no uuid', () => Promise.resolve('units')],
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherAdmin)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await missingCodes(await id())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })
})

describe('GET /lookup-table-suggestions', () => {
  const suggestions = (query: Record<string, string>, target = admin) =>
    target.inject({ method: 'GET', url: lookupTableSuggestionsEndpoint.path, query })

  it('suggests no entries for the Workspace until suggested code values exist', async () => {
    const response = await suggestions({ kind: 'units' })

    expect(response.statusCode).toBe(200)
    expect(lookupTableSuggestionsEndpoint.response.parse(response.json())).toEqual({
      entries: [],
    })
  })

  it('suggests no entries for a Trading Partner until suggested code values exist', async () => {
    const { id } = await postTradingPartner('Nordkontor GmbH')

    const response = await suggestions({ kind: 'countries', tradingPartnerId: id })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ entries: [] })
  })

  it.each([
    ['without a kind', {}],
    ['for an unknown kind', { kind: 'currencies' }],
    ['for a Trading Partner id that is no uuid', { kind: 'units', tradingPartnerId: 'nord' }],
    ['for an unknown language', { kind: 'units', language: 'fr' }],
  ])('answers 400 %s', async (_case, query) => {
    const response = await suggestions(query)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')
  })

  it.each([
    ['an unknown Trading Partner', () => Promise.resolve(unknownId)],
    [
      'a Trading Partner of another Workspace',
      async () => (await postTradingPartner('Nordkontor GmbH', otherAdmin)).id,
    ],
  ])('answers 422 for %s', async (_case, tradingPartnerId) => {
    const response = await suggestions({
      kind: 'units',
      tradingPartnerId: await tradingPartnerId(),
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({ message: 'Unknown Trading Partner' })
  })
})

describe('PUT /lookup-tables/:id', () => {
  const changes = (tradingPartnerId: string): LookupTableInput => ({
    name: 'Einheiten Hansemarkt',
    kind: 'other',
    scope: { kind: 'tradingPartner', tradingPartnerId },
    entries: [
      { sourceCode: 'KAR', targetCode: 'CS' },
      { sourceCode: 'KG', targetCode: 'KGM' },
      { sourceCode: 'ST', targetCode: 'PCE' },
    ],
  })

  it('stores the changed Lookup Table with its new entries in order', async () => {
    const hansemarkt = await postTradingPartner('Hansemarkt GmbH')
    const created = await posted(units)

    const response = await update(created.id, changes(hansemarkt.id))

    expect(response.statusCode).toBe(200)

    const updated = lookupTableSchema.parse(response.json())

    expect(updated).toEqual({
      ...created,
      ...changes(hansemarkt.id),
      scope: {
        kind: 'tradingPartner',
        tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt GmbH' },
      },
      entryCount: 3,
      codeMeanings: [],
      updatedAt: updated.updatedAt,
    })
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))

    const read = await get(created.id)

    expect(lookupTableSchema.parse(read.json())).toEqual(updated)
  })

  it('keeps its own name in a new spelling', async () => {
    const created = await posted(units)

    const response = await update(created.id, { ...units, name: 'MENGENEINHEITEN' })

    expect(response.statusCode).toBe(200)
  })

  it.each([
    ['an invalid Lookup Table', 400, () => ({ ...units, name: '' })],
    [
      'an unknown Trading Partner',
      422,
      () => ({ ...units, scope: { kind: 'tradingPartner' as const, tradingPartnerId: unknownId } }),
    ],
    ['a name another Lookup Table of the scope uses', 409, () => ({ ...units, name: 'Länder' })],
  ])('rejects %s and keeps the stored one', async (_case, status, body) => {
    await post({ ...units, name: 'Länder', kind: 'countries' })
    const created = await posted(units)

    const response = await update(created.id, body())

    expect(response.statusCode).toBe(status)
    expect(response.json()).toHaveProperty('message')

    const read = await get(created.id)

    expect(read.json()).toEqual(created)
  })

  it.each([
    ['an unknown id', () => Promise.resolve(unknownId)],
    ['an id that is no uuid', () => Promise.resolve('units')],
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherAdmin)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await update(await id(), units)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 before it checks the Lookup Table', async () => {
    const response = await update(unknownId, { ...units, name: '' })

    expect(response.statusCode).toBe(404)
  })

  it('leaves a Lookup Table of another Workspace unchanged', async () => {
    const foreign = await posted(units, otherAdmin)

    await update(foreign.id, { ...units, name: 'Taken over' })

    const read = await get(foreign.id, otherAdmin)

    expect(read.json()).toEqual(foreign)
  })
})

describe('DELETE /lookup-tables/:id', () => {
  it('deletes the Lookup Table with its entries', async () => {
    const created = await posted(units)
    const kept = await posted({ ...units, name: 'Länder', kind: 'countries' })

    const response = await remove(created.id)

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')

    const read = await get(created.id)

    expect(read.statusCode).toBe(404)

    const listed = await list()

    expect(listed.json()).toEqual([summaryOf(kept)])
  })

  it.each([
    ['an unknown id', () => Promise.resolve(unknownId)],
    ['an id that is no uuid', () => Promise.resolve('units')],
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherAdmin)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await remove(await id())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('leaves a Lookup Table of another Workspace in place', async () => {
    const foreign = await posted(units, otherAdmin)

    await remove(foreign.id)

    const read = await get(foreign.id, otherAdmin)

    expect(read.json()).toEqual(foreign)
  })
})

const postCsv = (endpoint: { path: string }, id: string, csv: string | number, target = admin) =>
  target.inject({ method: 'POST', url: endpoint.path.replace(':id', id), body: { csv } })

const previewImport = (id: string, csv: string | number) =>
  postCsv(lookupTableImportPreviewEndpoint, id, csv)

const importCsv = (id: string, csv: string | number, target = admin) =>
  postCsv(importLookupTableEndpoint, id, csv, target)

const notFoundCases = [
  ['an unknown id', () => Promise.resolve(unknownId)],
  ['an id that is no uuid', () => Promise.resolve('units')],
  ['a Lookup Table of another Workspace', async () => (await posted(units, otherAdmin)).id],
] as const

const invalidCsvCases = [
  ['no text', 42],
  ['a CSV beyond the maximum length', 'KG;KGM\n'.padEnd(maxLookupTableCsvLength + 1, '\n')],
] as const

describe('POST /lookup-tables/:id/import-preview', () => {
  it('classifies each row against the entries and reports the reasons of each invalid row', async () => {
    const created = await posted(units)

    const response = await previewImport(
      created.id,
      'Quelle;Ziel\nST;PCE\nKAR;BX\nKG;KGM\n;BX\nKG;KGS\nA;B;C',
    )

    expect(response.statusCode).toBe(200)
    expect(lookupTableImportPreviewSchema.parse(response.json())).toEqual({
      rows: [
        { line: 2, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
        {
          line: 3,
          status: 'changed',
          sourceCode: 'KAR',
          targetCode: 'BX',
          previousTargetCode: 'CT',
        },
        { line: 4, status: 'added', sourceCode: 'KG', targetCode: 'KGM' },
        { line: 5, status: 'invalid', cells: ['', 'BX'], reasons: ['sourceCodeMissing'] },
        { line: 6, status: 'invalid', cells: ['KG', 'KGS'], reasons: ['duplicateSourceCode'] },
        { line: 7, status: 'invalid', cells: ['A', 'B', 'C'], reasons: ['columnCount'] },
      ],
    })
  })

  it('leaves the entries unchanged', async () => {
    const created = await posted(units)

    await previewImport(created.id, 'KAR;BX\nKG;KGM')

    const read = await get(created.id)

    expect(read.json()).toEqual(created)
  })

  it.each(notFoundCases)('answers 404 for %s', async (_case, id) => {
    const response = await previewImport(await id(), 'ST;PCE')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 before it checks the CSV', async () => {
    const response = await previewImport(unknownId, 42)

    expect(response.statusCode).toBe(404)
  })

  it.each(invalidCsvCases)('answers 400 for %s', async (_case, csv) => {
    const created = await posted(units)

    const response = await previewImport(created.id, csv)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')
  })

  it('accepts a CSV up to the maximum length', async () => {
    const created = await posted(units)

    const response = await previewImport(
      created.id,
      'KG;KGM\n'.padEnd(maxLookupTableCsvLength, '\n'),
    )

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      rows: [{ line: 1, status: 'added', sourceCode: 'KG', targetCode: 'KGM' }],
    })
  })
})

describe('POST /lookup-tables/:id/import', () => {
  it('adds and changes the valid rows and keeps the other entries in order', async () => {
    const created = await posted({
      ...units,
      entries: [...units.entries, { sourceCode: 'L', targetCode: 'LTR' }],
    })

    const response = await importCsv(created.id, 'KG;KGM\nKAR;BX\n;BX\nST;PCE')

    expect(response.statusCode).toBe(200)

    const imported = lookupTableSchema.parse(response.json())

    expect(imported).toEqual({
      ...created,
      entryCount: 4,
      entries: [
        { sourceCode: 'ST', targetCode: 'PCE' },
        { sourceCode: 'KAR', targetCode: 'BX' },
        { sourceCode: 'L', targetCode: 'LTR' },
        { sourceCode: 'KG', targetCode: 'KGM' },
      ],
      codeMeanings: [
        { code: 'PCE', meaning: 'Piece' },
        { code: 'BX', meaning: 'Box' },
        { code: 'LTR', meaning: 'Litre' },
        { code: 'KGM', meaning: 'Kilogram' },
      ],
      updatedAt: imported.updatedAt,
    })
    expect(Date.parse(imported.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))

    const read = await get(created.id)

    expect(read.json()).toEqual(imported)
  })

  it('imports more entries than one insert statement takes', async () => {
    const created = await posted(units)
    const sourceCodes = Array.from({ length: 20_000 }, (_, index) => `C${index}`)

    const response = await importCsv(created.id, sourceCodes.map((code) => `${code};X`).join('\n'))

    const imported = lookupTableSchema.parse(response.json())

    expect(imported.entryCount).toBe(20_002)
    expect(imported.entries.at(-1)).toEqual({ sourceCode: 'C19999', targetCode: 'X' })
  })

  it.each(notFoundCases)('answers 404 for %s', async (_case, id) => {
    const response = await importCsv(await id(), 'ST;PCE')

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 before it checks the CSV', async () => {
    const response = await importCsv(unknownId, 42)

    expect(response.statusCode).toBe(404)
  })

  it.each(invalidCsvCases)('answers 400 for %s and keeps the entries', async (_case, csv) => {
    const created = await posted(units)

    const response = await importCsv(created.id, csv)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const read = await get(created.id)

    expect(read.json()).toEqual(created)
  })

  it('accepts a CSV up to the maximum length', async () => {
    const created = await posted(units)

    const response = await importCsv(created.id, 'KG;KGM\n'.padEnd(maxLookupTableCsvLength, '\n'))

    expect(response.statusCode).toBe(200)
  })

  it('leaves a Lookup Table of another Workspace unchanged', async () => {
    const foreign = await posted(units, otherAdmin)

    await importCsv(foreign.id, 'KG;KGM')

    const read = await get(foreign.id, otherAdmin)

    expect(read.json()).toEqual(foreign)
  })
})

describe('a Lookup Table deleted right after a write', () => {
  let deleting: Connection

  let deletingApp: FastifyInstance

  let deletingAdmin: Client

  beforeAll(async () => {
    deleting = connect(api.databaseUrl)

    const transaction = deleting.db.transaction.bind(deleting.db)

    deleting.db.transaction = async <T>(write: (tx: Transaction) => Promise<T>) => {
      const result = await transaction(write)

      await deleting.db.delete(lookupTables)

      return result
    }

    deletingApp = buildApp({
      auth: testAuth,
      channels: testChannels,
      database: deleting.db,
      probes: { postgres: up, redis: up },
      runQueue: testRunQueue().service,
      webhookRateLimiter: memoryWebhookRateLimiter(),
    })
    deletingAdmin = await signIn(deletingApp, ownAdmin)
  })

  afterAll(async () => {
    await deletingApp.close()
    await deleting.close()
  })

  it('answers the created Lookup Table', async () => {
    const response = await post(units, deletingAdmin)

    expect(response.statusCode).toBe(201)
    expect(lookupTableSchema.parse(response.json()).entries).toEqual(units.entries)
  })

  it('answers the updated Lookup Table', async () => {
    const created = await posted(units)

    const response = await update(created.id, { ...units, name: 'Einheiten' }, deletingAdmin)

    expect(response.statusCode).toBe(200)
    expect(lookupTableSchema.parse(response.json()).name).toBe('Einheiten')
  })

  it('answers the imported Lookup Table', async () => {
    const created = await posted(units)

    const response = await importCsv(created.id, 'KG;KGM', deletingAdmin)

    expect(response.statusCode).toBe(200)
    expect(lookupTableSchema.parse(response.json()).entryCount).toBe(3)
  })
})
