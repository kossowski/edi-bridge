import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { LightMyRequestResponse } from 'fastify'

import {
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  deleteLookupTableEndpoint,
  type DocumentStructureOrigin,
  documentStructureOrigins,
  documentStructureProblemSchema,
  documentStructureSchema,
  documentStructuresEndpoint,
  documentStructureSummarySchema,
  lookupTableEndpoint,
  lookupTableInUseMessage,
  lookupTableInUseStatus,
  lookupTableSchema,
  lookupTablesEndpoint,
  lookupTableSummarySchema,
  type MappingGraph,
  mappingSummarySchema,
  mappingVersionEntrySchema,
  type MessageType,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
  type UpdateDocumentStructureBody,
  updateDocumentStructureEndpoint,
} from '@edi-bridge/contracts'
import { type Connection, documentStructures, lookupTables, mappings } from '@edi-bridge/db'

import { type Client, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let connection: Connection

let admin: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(mappings)
  await connection.db.delete(documentStructures)
  await connection.db.delete(lookupTables)
})

const createdStructure = async (name: string, origin: DocumentStructureOrigin) => {
  const response = await admin.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name, origin },
  })

  expect(response.statusCode).toBe(201)

  return documentStructureSchema.parse(response.json())
}

const createdMapping = async (messageType: MessageType = 'ORDERS') => {
  const response = await admin.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType },
  })

  expect(response.statusCode).toBe(201)

  return mappingSummarySchema.parse(response.json())
}

const save = async (id: string, graph: MappingGraph) => {
  const response = await admin.inject({
    method: 'PUT',
    url: toPath(saveMappingDraftEndpoint.path, { id }),
    body: graph,
  })

  expect(response.statusCode).toBe(200)
}

const published = async (mappingId: string) => {
  const response = await admin.inject({
    method: 'POST',
    url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
    body: { changeNote: 'First version' },
  })

  expect(response.statusCode).toBe(201)

  return mappingVersionEntrySchema.parse(response.json())
}

const empty: MappingGraph = { links: [], transforms: [], transformLinks: [] }

const linking = (sourcePath: string, targetPath: string): MappingGraph => ({
  ...empty,
  links: [{ sourcePath, targetPath }],
})

const lookupTransformId = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const translating = (lookupTableId: string): MappingGraph => ({
  links: [],
  transforms: [
    {
      id: lookupTransformId,
      kind: 'lookupTable',
      position: { x: 320, y: 80 },
      config: { lookupTableId, fallback: 'keepValue' },
    },
  ],
  transformLinks: [
    {
      from: { kind: 'source', path: 'BGM/1004' },
      to: { kind: 'transform', transformId: lookupTransformId, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: lookupTransformId, output: 'value' },
      to: { kind: 'target', path: 'orderNumber' },
    },
  ],
})

const createdLookupTable = async (name = 'Mengeneinheiten') => {
  const response = await admin.inject({
    method: 'POST',
    url: createLookupTableEndpoint.path,
    body: {
      name,
      kind: 'units',
      scope: { kind: 'workspace' },
      entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
    },
  })

  expect(response.statusCode).toBe(201)

  return lookupTableSchema.parse(response.json())
}

const update = (id: string, body: UpdateDocumentStructureBody) =>
  admin.inject({ method: 'PUT', url: toPath(updateDocumentStructureEndpoint.path, { id }), body })

const problemOf = (response: LightMyRequestResponse) => {
  expect(response.statusCode).toBe(422)

  return documentStructureProblemSchema.parse(response.json())
}

describe('GET /document-structures', () => {
  it('names the Mappings that use each Document Structure by name', async () => {
    const orders = await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const first = await createdMapping('ORDERS')
    const second = await createdMapping('DESADV')
    await createdStructure('Lieferscheine', documentStructureOrigins.csvDocument)

    const response = await admin.inject({ method: 'GET', url: documentStructuresEndpoint.path })

    expect(response.statusCode).toBe(200)

    const summaries = documentStructureSummarySchema.array().parse(response.json())

    expect(summaries.map(({ name, mappings: uses }) => ({ name, uses }))).toEqual([
      {
        name: 'ERP orders',
        uses: [first, second]
          .map(({ id, name }) => ({ id, name }))
          .toSorted((a, b) => a.name.localeCompare(b.name, 'de')),
      },
      { name: 'Lieferscheine', uses: [] },
    ])
    expect(summaries[0]?.id).toBe(orders.id)
  })
})

describe('PUT /document-structures/:id used by Mappings', () => {
  it('refuses a change that removes a node a Draft links', async () => {
    const orders = await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const mapping = await createdMapping()
    await save(mapping.id, linking('SG2+BY/NAD+BY/C082/3039', 'buyer.gln'))

    const problem = problemOf(
      await update(orders.id, {
        name: orders.name,
        adjustments: [{ path: 'buyer', repeating: true }],
      }),
    )

    expect(problem).toMatchObject({ code: 'linkedByMapping', path: 'buyer', mappingVersions: null })
  })

  it('lets a structure only Drafts use change the type of a linked field', async () => {
    const orders = await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const mapping = await createdMapping()
    await save(mapping.id, linking('BGM/1004', 'orderNumber'))

    const response = await update(orders.id, {
      name: orders.name,
      adjustments: [{ path: 'orderNumber', type: 'integer' }],
    })

    expect(response.statusCode).toBe(200)
  })

  it('refuses a change of a field a published Mapping Version links', async () => {
    const orders = await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const mapping = await createdMapping()
    await save(mapping.id, linking('BGM/1004', 'orderNumber'))
    const version = await published(mapping.id)
    await save(mapping.id, empty)

    const problem = problemOf(
      await update(orders.id, {
        name: orders.name,
        adjustments: [{ path: 'orderNumber', type: 'integer' }],
      }),
    )

    expect(problem).toMatchObject({
      code: 'usedByMappingVersion',
      path: 'orderNumber',
      mappingVersions: [
        {
          id: version.id,
          mappingId: mapping.id,
          mappingName: mapping.name,
          version: 1,
          publishedAt: version.publishedAt,
        },
      ],
    })
  })

  it('lets a used structure change a field no published Mapping Version links', async () => {
    const orders = await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const mapping = await createdMapping()
    await save(mapping.id, linking('BGM/1004', 'orderNumber'))
    await published(mapping.id)

    const response = await update(orders.id, {
      name: orders.name,
      adjustments: [{ path: 'currency', required: false, label: 'Währung' }],
    })

    expect(response.statusCode).toBe(200)
  })

  it('refuses new CSV settings for a structure a published Mapping Version reads', async () => {
    const dispatch = await createdStructure('Lieferscheine', documentStructureOrigins.csvDocument)
    const mapping = await createdMapping()
    await save(mapping.id, linking('BGM/1004', 'rows[].Lieferscheinnummer'))
    const version = await published(mapping.id)

    const problem = problemOf(
      await update(dispatch.id, {
        name: dispatch.name,
        csv: { delimiter: ',', headerRow: false, encoding: 'utf-8' },
        adjustments: [],
      }),
    )

    expect(problem).toMatchObject({
      code: 'usedByMappingVersion',
      path: null,
      mappingVersions: [{ id: version.id }],
    })
  })
})

const lookupTableSummaries = async () => {
  const response = await admin.inject({ method: 'GET', url: lookupTablesEndpoint.path })

  expect(response.statusCode).toBe(200)

  return lookupTableSummarySchema.array().parse(response.json())
}

const removeLookupTable = (id: string) =>
  admin.inject({ method: 'DELETE', url: toPath(deleteLookupTableEndpoint.path, { id }) })

describe('Lookup Tables used by Mappings', () => {
  it('names the Mappings whose Draft uses a Lookup Table', async () => {
    await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const units = await createdLookupTable()
    await createdLookupTable('Länder')
    const mapping = await createdMapping()
    await save(mapping.id, translating(units.id))

    const summaries = await lookupTableSummaries()

    expect(summaries.map(({ name, uses }) => ({ name, uses }))).toEqual([
      { name: 'Länder', uses: [] },
      {
        name: 'Mengeneinheiten',
        uses: [
          {
            mappingId: mapping.id,
            name: mapping.name,
            messageType: 'ORDERS',
            direction: 'inbound',
            tradingPartners: [],
          },
        ],
      },
    ])

    const read = await admin.inject({
      method: 'GET',
      url: toPath(lookupTableEndpoint.path, { id: units.id }),
    })

    expect(lookupTableSchema.parse(read.json()).uses).toEqual(summaries[1]?.uses)
  })

  it('names a Mapping whose published Mapping Version alone still uses a Lookup Table', async () => {
    await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const units = await createdLookupTable()
    const mapping = await createdMapping()
    await save(mapping.id, translating(units.id))
    await published(mapping.id)
    await save(mapping.id, empty)

    const [summary] = await lookupTableSummaries()

    expect(summary?.uses.map(({ mappingId }) => mappingId)).toEqual([mapping.id])
  })

  it('refuses to delete a Lookup Table a Draft uses', async () => {
    await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const units = await createdLookupTable()
    const mapping = await createdMapping()
    await save(mapping.id, translating(units.id))

    const response = await removeLookupTable(units.id)

    expect(response.statusCode).toBe(lookupTableInUseStatus)
    expect(response.json()).toMatchObject({ message: lookupTableInUseMessage })
    expect(await lookupTableSummaries()).toHaveLength(1)
  })

  it('refuses to delete a Lookup Table a published Mapping Version uses', async () => {
    await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const units = await createdLookupTable()
    const mapping = await createdMapping()
    await save(mapping.id, translating(units.id))
    await published(mapping.id)
    await save(mapping.id, empty)

    expect((await removeLookupTable(units.id)).statusCode).toBe(lookupTableInUseStatus)
  })

  it('deletes a Lookup Table once no Mapping uses it', async () => {
    await createdStructure('ERP orders', documentStructureOrigins.jsonDocument)
    const units = await createdLookupTable()
    await createdMapping()

    expect((await removeLookupTable(units.id)).statusCode).toBe(204)
  })
})
