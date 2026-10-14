import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import {
  createTradingPartnerEndpoint,
  type TradingPartnerInput,
  tradingPartnerEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  updateTradingPartnerEndpoint,
  withCheckDigit,
} from '@edi-bridge/contracts'
import { connect, type Connection, tradingPartners, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { seedDevelopmentWorkspace } from './workspace.js'

const up = () => Promise.resolve()

type TradingPartnerBody = Omit<
  TradingPartnerInput,
  'characterSet' | 'acknowledgementTimeLimitHours'
> & {
  characterSet: string
  acknowledgementTimeLimitHours: number | undefined
}

const hansemarkt: TradingPartnerInput = {
  name: 'Hansemarkt GmbH',
  gln: withCheckDigit('400000000001'),
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
}

let testDatabase: TestDatabase

let connection: Connection

let app: FastifyInstance

let otherApp: FastifyInstance

const otherWorkspace = {
  id: '8b2d6e14-3f9a-4c57-a0d8-71e5b9c4f236',
  name: 'Sudhafen Logistik AG',
  gln: null,
}

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
  await connection.db.delete(tradingPartners)
})

const post = (body: TradingPartnerBody, target = app) =>
  target.inject({ method: 'POST', url: createTradingPartnerEndpoint.path, body })

const postedTradingPartner = async (body: TradingPartnerBody, target = app) =>
  tradingPartnerSchema.parse((await post(body, target)).json())

const list = (target = app) => target.inject({ method: 'GET', url: tradingPartnersEndpoint.path })

const get = (id: string, target = app) =>
  target.inject({ method: 'GET', url: tradingPartnerEndpoint.path.replace(':id', id) })

const update = (id: string, body: TradingPartnerBody, target = app) =>
  target.inject({
    method: 'PUT',
    url: updateTradingPartnerEndpoint.path.replace(':id', id),
    body,
  })

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

describe('POST /trading-partners', () => {
  it('creates a Trading Partner in Test Mode with no onboarding yet', async () => {
    const response = await post(hansemarkt)

    expect(response.statusCode).toBe(201)

    const created = tradingPartnerSchema.parse(response.json())

    expect(created).toEqual({
      ...hansemarkt,
      id: created.id,
      testMode: true,
      onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
    })

    const read = await get(created.id)

    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual(created)
  })

  it.each([
    ['an empty name', { ...hansemarkt, name: ' ' }],
    ['a GLN with a wrong check digit', { ...hansemarkt, gln: '4000000000010' }],
    ['an unknown character set', { ...hansemarkt, characterSet: 'UTF8' }],
    ['a time limit above a week', { ...hansemarkt, acknowledgementTimeLimitHours: 169 }],
    ['no time limit', { ...hansemarkt, acknowledgementTimeLimitHours: undefined }],
  ])('rejects %s', async (_case, body) => {
    const response = await post(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const listed = await list()

    expect(listed.json()).toEqual([])
  })
})

describe('GET /trading-partners', () => {
  it('lists the Trading Partners of the Workspace by name', async () => {
    const created = []

    for (const name of ['Rheinkauf eG', 'Alpenfrisch Märkte AG', 'Ölmühle Ost GmbH']) {
      created.push(await postedTradingPartner({ ...hansemarkt, name, gln: null }))
    }

    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([created[1], created[2], created[0]])
  })

  it('lists nothing for a Workspace without Trading Partners', async () => {
    const response = await list()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })
})

describe('GET /trading-partners/:id', () => {
  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'activity'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await get(id)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })
})

describe('PUT /trading-partners/:id', () => {
  const changes: TradingPartnerInput = {
    name: 'Hansemarkt Nord GmbH',
    gln: withCheckDigit('400000000002'),
    characterSet: 'UNOA',
    acknowledgementTimeLimitHours: 48,
  }

  it('stores the changed Trading Partner and keeps its onboarding', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, changes)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...created, ...changes })

    const read = await get(created.id)

    expect(read.json()).toEqual({ ...created, ...changes })
  })

  it('rejects an invalid Trading Partner and keeps the stored one', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...changes, name: '' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')

    const read = await get(created.id)

    expect(read.json()).toEqual(created)
  })

  it.each([
    ['an unknown id', unknownId],
    ['an id that is no uuid', 'activity'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await update(id, changes)

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Not found' })
  })

  it('answers 404 before it checks the Trading Partner', async () => {
    const response = await update(unknownId, { ...changes, name: '' })

    expect(response.statusCode).toBe(404)
  })
})

describe('a Trading Partner of another Workspace', () => {
  it('is neither listed, read nor updated', async () => {
    const own = await postedTradingPartner(hansemarkt)

    const foreign = await postedTradingPartner(
      { ...hansemarkt, name: 'Elbtal Warenhaus KG' },
      otherApp,
    )

    const listed = await list()

    expect(listed.json()).toEqual([own])

    const read = await get(foreign.id)

    expect(read.statusCode).toBe(404)

    const updated = await update(foreign.id, { ...hansemarkt, name: 'Taken over' })

    expect(updated.statusCode).toBe(404)

    const unchanged = await get(foreign.id, otherApp)

    expect(unchanged.json()).toEqual(foreign)
  })
})

describe('the GLN of a Trading Partner', () => {
  const glnConflict = { message: 'Another Trading Partner already uses this GLN' }

  it('is unique within the Workspace on create', async () => {
    await postedTradingPartner(hansemarkt)

    const response = await post({ ...hansemarkt, name: 'Rheinkauf eG' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(glnConflict)

    const listed = await list()

    expect(listed.json()).toHaveLength(1)
  })

  it('is unique within the Workspace on update', async () => {
    await postedTradingPartner(hansemarkt)
    const other = await postedTradingPartner({ ...hansemarkt, name: 'Rheinkauf eG', gln: null })

    const response = await update(other.id, { ...hansemarkt, name: 'Rheinkauf eG' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(glnConflict)

    const read = await get(other.id)

    expect(read.json()).toEqual(other)
  })

  it('stays with the Trading Partner that updates itself', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...hansemarkt, acknowledgementTimeLimitHours: 4 })

    expect(response.statusCode).toBe(200)
  })

  it('may be used by Trading Partners without a GLN and in another Workspace', async () => {
    await postedTradingPartner({ ...hansemarkt, gln: null })
    await postedTradingPartner(hansemarkt, otherApp)

    const second = await post({ ...hansemarkt, name: 'Rheinkauf eG', gln: null })
    const own = await post(hansemarkt)

    expect(second.statusCode).toBe(201)
    expect(own.statusCode).toBe(201)
  })

  it('stays once Interchanges were exchanged', async () => {
    const created = await postedTradingPartner(hansemarkt)

    await connection.db
      .update(tradingPartners)
      .set({ testInterchangeSentAt: new Date('2026-10-06T14:03:00.000Z') })
      .where(eq(tradingPartners.id, created.id))

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'The Trading Partner needs its GLN once Interchanges were exchanged',
    })

    const read = await get(created.id)

    expect(read.json()).toEqual({
      ...created,
      onboarding: { testInterchangeSentAt: '2026-10-06T14:03:00.000Z', contrlReceivedAt: null },
    })
  })

  it('stays once the Trading Partner is in production', async () => {
    const created = await postedTradingPartner(hansemarkt)

    await connection.db
      .update(tradingPartners)
      .set({ testMode: false })
      .where(eq(tradingPartners.id, created.id))

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(422)
  })

  it('may be removed during Test Mode before the test Interchange', async () => {
    const created = await postedTradingPartner(hansemarkt)

    const response = await update(created.id, { ...hansemarkt, gln: null })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...created, gln: null })
  })
})
