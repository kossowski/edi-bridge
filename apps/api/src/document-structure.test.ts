import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { FastifyInstance } from 'fastify'

import {
  type CreateDocumentStructureBody,
  createDocumentStructureEndpoint,
  defaultCsvSettings,
  documentStructureEndpoint,
  documentStructureSchema,
  documentStructuresEndpoint,
  documentStructureSummarySchema,
  type DocumentStructureOrigin,
  documentStructureProblemSchema,
  documentStructureOrigins,
  findNode,
  inferDocumentStructureEndpoint,
  inferredDocumentStructureSchema,
  toEncodedFile,
  windows1252CsvSettings,
} from '@edi-bridge/contracts'
import { connect, type Connection, documentStructures, workspaces } from '@edi-bridge/db'
import { startTestDatabase, type TestDatabase } from '@edi-bridge/db/testing'

import { buildApp } from './app.js'
import { otherWorkspace } from './testing.js'
import { seedDevelopmentWorkspace } from './workspace.js'

const up = () => Promise.resolve()

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
  await connection.db.delete(documentStructures)
})

const infer = (body: DocumentStructureOrigin) =>
  app.inject({ method: 'POST', url: inferDocumentStructureEndpoint.path, body })

const inferred = async (body: DocumentStructureOrigin) => {
  const response = await infer(body)

  expect(response.statusCode).toBe(200)

  return inferredDocumentStructureSchema.parse(response.json())
}

describe('POST /document-structures/inference', () => {
  it('infers nesting and repetitions from a JSON sample Document', async () => {
    const structure = await inferred(documentStructureOrigins.jsonDocument)

    expect(structure).toMatchObject({
      format: 'json',
      root: 'object',
      sample: { fileName: 'order.json' },
    })
    expect(findNode(structure.children, 'buyer.city')).toMatchObject({ kind: 'field' })
    expect(findNode(structure.children, 'lines[]')).toMatchObject({
      kind: 'array',
      items: { kind: 'object' },
    })
    expect(findNode(structure.children, 'lines[].gtin')).toMatchObject({
      kind: 'field',
      type: 'string',
    })
  })

  it('infers one repeating row of column fields from a CSV sample Document', async () => {
    const structure = await inferred(documentStructureOrigins.csvDocument)

    expect(structure).toMatchObject({
      format: 'csv',
      csv: defaultCsvSettings,
      facts: { columnCount: 8, rowCount: 3 },
    })
    expect(findNode(structure.children, 'rows[]')).toMatchObject({
      kind: 'array',
      items: { kind: 'object' },
    })
    expect(findNode(structure.children, 'rows[].Straße')).toMatchObject({ kind: 'field' })
  })

  it('reads the umlauts of a Windows-1252 CSV when that encoding is configured', async () => {
    const structure = await inferred(documentStructureOrigins.windows1252CsvDocument)

    expect(structure).toMatchObject({ format: 'csv', csv: windows1252CsvSettings })
    expect(findNode(structure.children, 'rows[].Straße')).toMatchObject({ kind: 'field' })
    expect(structure.sample?.text).toContain('Alpenfrisch Märkte AG;Maximilianstraße 3;München')
  })

  it('answers unreadableContent for a Windows-1252 CSV read as UTF-8', async () => {
    const response = await infer({
      ...documentStructureOrigins.windows1252CsvDocument,
      csv: defaultCsvSettings,
    })

    expect(response.statusCode).toBe(422)
    expect(documentStructureProblemSchema.parse(response.json())).toMatchObject({
      code: 'unreadableContent',
    })
  })

  it('creates the tree of a JSON Schema without a sample', async () => {
    const structure = await inferred(documentStructureOrigins.jsonSchema)

    expect(structure).toMatchObject({ format: 'json', root: 'object', sample: null })
    expect(findNode(structure.children, 'supplier.gln')).toMatchObject({ required: true })
    expect(findNode(structure.children, 'prices[].minimumQuantity')).toMatchObject({
      type: 'integer',
      required: false,
    })
  })

  it('answers the problem of a Document it cannot read', async () => {
    const response = await infer(documentStructureOrigins.invalidJsonDocument)

    expect(response.statusCode).toBe(422)
    expect(documentStructureProblemSchema.parse(response.json())).toMatchObject({
      code: 'invalidJson',
    })
  })

  it('reads a CSV Document larger than a megabyte', async () => {
    const row = 'LS-88121;03.10.2026;Hansemarkt GmbH;Lübeck;04012345123456;24'

    const csv = [
      'Lieferschein;Datum;Kunde;Ort;GTIN;Menge',
      ...Array.from({ length: 30_000 }, () => row),
    ].join('\n')

    const structure = await inferred({
      kind: 'csvDocument',
      document: toEncodedFile('gross.csv', csv),
      csv: defaultCsvSettings,
    })

    expect(structure.facts).toEqual({ columnCount: 6, rowCount: 30_000 })
  })

  it('refuses an origin that does not match the contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: inferDocumentStructureEndpoint.path,
      body: { kind: 'xmlDocument' },
    })

    expect(response.statusCode).toBe(400)
  })
})

const create = (body: CreateDocumentStructureBody, target = app) =>
  target.inject({ method: 'POST', url: createDocumentStructureEndpoint.path, body })

const created = async (body: CreateDocumentStructureBody, target = app) => {
  const response = await create(body, target)

  expect(response.statusCode).toBe(201)

  return documentStructureSchema.parse(response.json())
}

const get = (id: string, target = app) =>
  target.inject({ method: 'GET', url: documentStructureEndpoint.path.replace(':id', id) })

const list = async (target = app) => {
  const response = await target.inject({ method: 'GET', url: documentStructuresEndpoint.path })

  expect(response.statusCode).toBe(200)

  return documentStructureSummarySchema.array().parse(response.json())
}

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

describe('POST /document-structures', () => {
  it('creates a Document Structure from a JSON sample Document', async () => {
    const structure = await created({
      name: 'ERP orders',
      origin: documentStructureOrigins.jsonDocument,
    })

    expect(structure).toMatchObject({
      name: 'ERP orders',
      format: 'json',
      root: 'object',
      sample: { fileName: 'order.json' },
    })
    expect(structure.sample?.text).toContain('"city": "Lübeck"')
    expect(findNode(structure.children, 'lines[].gtin')).toMatchObject({ kind: 'field' })

    const read = await get(structure.id)

    expect(read.statusCode).toBe(200)
    expect(documentStructureSchema.parse(read.json())).toEqual(structure)
  })

  it('names nodes with the plain names chosen at creation', async () => {
    const structure = await created({
      name: 'ERP orders',
      origin: documentStructureOrigins.jsonDocument,
      labels: [{ path: 'orderNumber', label: 'Bestellnummer' }],
    })

    expect(findNode(structure.children, 'orderNumber')).toMatchObject({
      label: 'Bestellnummer',
      labelReason: null,
      labelUnsure: false,
    })
  })

  it('creates a Document Structure from a JSON Schema', async () => {
    const structure = await created({
      name: 'Article master data',
      origin: documentStructureOrigins.jsonSchema,
    })

    expect(structure).toMatchObject({ format: 'json', root: 'object', sample: null })
    expect(findNode(structure.children, 'prices[]')).toMatchObject({
      kind: 'array',
      required: true,
    })
    expect(documentStructureSchema.parse((await get(structure.id)).json())).toEqual(structure)
  })

  it('keeps the CSV settings and the umlauts of a Windows-1252 CSV', async () => {
    const structure = await created({
      name: 'Lieferscheine',
      origin: documentStructureOrigins.windows1252CsvDocument,
    })

    const read = documentStructureSchema.parse((await get(structure.id)).json())

    expect(read).toMatchObject({ format: 'csv', csv: windows1252CsvSettings })
    expect(read.sample?.text).toContain('Königstraße 12;Lübeck')
    expect(findNode(read.children, 'rows[].Straße')).toMatchObject({ kind: 'field' })
  })

  it('answers the problem of a Document it cannot read and stores nothing', async () => {
    const response = await create({
      name: 'Broken',
      origin: documentStructureOrigins.invalidJsonDocument,
    })

    expect(response.statusCode).toBe(422)
    expect(documentStructureProblemSchema.parse(response.json())).toMatchObject({
      code: 'invalidJson',
    })
    await expect(list()).resolves.toEqual([])
  })

  it('answers unknownPath for a plain name of a node the structure does not have', async () => {
    const response = await create({
      name: 'ERP orders',
      origin: documentStructureOrigins.jsonDocument,
      labels: [{ path: 'shipTo.city', label: 'Lieferort' }],
    })

    expect(response.statusCode).toBe(422)
    expect(documentStructureProblemSchema.parse(response.json())).toMatchObject({
      code: 'unknownPath',
      path: 'shipTo.city',
    })
  })

  it('refuses a body that does not match the contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: createDocumentStructureEndpoint.path,
      body: { name: '', origin: documentStructureOrigins.jsonDocument },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('GET /document-structures', () => {
  it('summarises the Document Structures of the Workspace by name', async () => {
    const orders = await created({
      name: 'ERP orders',
      origin: documentStructureOrigins.jsonDocument,
    })

    const articles = await created({
      name: 'Article master data',
      origin: documentStructureOrigins.jsonSchema,
    })

    await expect(list()).resolves.toEqual([
      {
        id: articles.id,
        name: 'Article master data',
        format: 'json',
        fieldCount: 12,
        firstFieldLabels: ['Article number', 'Article number (GTIN)', 'Description'],
        sample: null,
        mappings: [],
      },
      {
        id: orders.id,
        name: 'ERP orders',
        format: 'json',
        fieldCount: 13,
        firstFieldLabels: ['Order number', 'Order date', 'Currency'],
        sample: {
          fileName: 'order.json',
          takenAt: orders.sample?.takenAt,
          preview: [
            '{',
            '  "orderNumber": "PO-2026-10417",',
            '  "orderDate": "2026-10-02",',
            '  "currency": "EUR",',
            '  "note": null,',
            '  "buyer": {',
            '    "gln": "4012345000016",',
          ].join('\n'),
        },
        mappings: [],
      },
    ])
  })

  it('lists no Document Structures of another Workspace', async () => {
    await created({ name: 'ERP orders', origin: documentStructureOrigins.jsonDocument })

    await expect(list(otherApp)).resolves.toEqual([])
  })
})

describe('GET /document-structures/:id', () => {
  it('answers 404 for a Document Structure of another Workspace', async () => {
    const structure = await created({
      name: 'ERP orders',
      origin: documentStructureOrigins.jsonDocument,
    })

    expect((await get(structure.id, otherApp)).statusCode).toBe(404)
  })

  it('answers 404 for an unknown or malformed id', async () => {
    expect((await get(unknownId)).statusCode).toBe(404)
    expect((await get('not-an-id')).statusCode).toBe(404)
  })
})
