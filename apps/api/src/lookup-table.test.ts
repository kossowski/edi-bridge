import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import {
  createLookupTableEndpoint,
  createTradingPartnerEndpoint,
  deleteLookupTableEndpoint,
  type LookupTable,
  type LookupTableInput,
  lookupTableEndpoint,
  lookupTableSchema,
  lookupTablesEndpoint,
  lookupTableSummarySchema,
  tradingPartnerSchema,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'
import { connect, type Connection, lookupTables, tradingPartners, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { otherWorkspace } from './testing.js'
import { seedDevelopmentWorkspace } from './workspace.js'

const up = () => Promise.resolve()

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

let testDatabase: TestDatabase

let connection: Connection

let app: FastifyInstance

let otherApp: FastifyInstance

beforeAll(async () => {
  testDatabase = await startTestDatabase()
  connection = connect(testDatabase.url)
  await seedDevelopmentWorkspace(connection.db)
  await connection.db.insert(workspaces).values(otherWorkspace)
  app = buildApp({ database: connection.db, probes: { postgres: up, redis: up } })
  otherApp = buildApp({
    database: connection.db,
    probes: { postgres: up, redis: up },
    resolveWorkspace: () => otherWorkspace.id,
  })
}, 60_000)

afterAll(async () => {
  await app.close()
  await otherApp.close()
  await connection.close()
  await testDatabase.stop()
})

beforeEach(async () => {
  await connection.db.delete(lookupTables)
  await connection.db.delete(tradingPartners)
})

const post = (body: LookupTableBody, target = app) =>
  target.inject({ method: 'POST', url: createLookupTableEndpoint.path, body })

const get = (id: string, target = app) =>
  target.inject({ method: 'GET', url: lookupTableEndpoint.path.replace(':id', id) })

const posted = async (body: LookupTableBody, target = app) =>
  lookupTableSchema.parse((await post(body, target)).json())

const update = (id: string, body: LookupTableBody, target = app) =>
  target.inject({ method: 'PUT', url: updateLookupTableEndpoint.path.replace(':id', id), body })

const remove = (id: string, target = app) =>
  target.inject({ method: 'DELETE', url: deleteLookupTableEndpoint.path.replace(':id', id) })

const list = (target = app) => target.inject({ method: 'GET', url: lookupTablesEndpoint.path })

const summaryOf = (table: LookupTable) => lookupTableSummarySchema.parse(table)

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const postTradingPartner = async (name: string, target = app) =>
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
  codeMeanings: [],
}

describe('POST /lookup-tables', () => {
  it('creates a Lookup Table of the Workspace with its entries in order', async () => {
    const response = await post(units)

    expect(response.statusCode).toBe(201)

    const created = lookupTableSchema.parse(response.json())

    expect(created).toEqual({
      ...units,
      ...unused,
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
      async () => (await postTradingPartner('Elbtal Warenhaus KG', otherApp)).id,
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
      await post(units, otherApp),
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
    await post(units, otherApp)

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
  it.each([
    ['an unknown id', () => Promise.resolve(unknownId)],
    ['an id that is no uuid', () => Promise.resolve('units')],
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherApp)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await get(await id())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
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
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherApp)).id],
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
    const foreign = await posted(units, otherApp)

    await update(foreign.id, { ...units, name: 'Taken over' })

    const read = await get(foreign.id, otherApp)

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
    ['a Lookup Table of another Workspace', async () => (await posted(units, otherApp)).id],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await remove(await id())

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('leaves a Lookup Table of another Workspace in place', async () => {
    const foreign = await posted(units, otherApp)

    await remove(foreign.id)

    const read = await get(foreign.id, otherApp)

    expect(read.json()).toEqual(foreign)
  })
})
