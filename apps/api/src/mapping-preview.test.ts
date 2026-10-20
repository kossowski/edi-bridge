import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { InjectOptions } from 'fastify'

import {
  createDocumentStructureEndpoint,
  createLookupTableEndpoint,
  createMappingEndpoint,
  documentStructureOrigins,
  documentStructureSchema,
  lookupTableSchema,
  mappingComparisonEndpoint,
  mappingComparisonSchema,
  type LookupTableEntry,
  type MappingGraph,
  mappingPreviewEndpoint,
  mappingPreviewSchema,
  mappingSampleSchema,
  mappingSamplesEndpoint,
  mappingSummarySchema,
  mappingVersionEntrySchema,
  publishMappingDraftEndpoint,
  saveMappingDraftEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { type Connection, documentStructures, lookupTables, mappings } from '@edi-bridge/db'

import { Db } from './db.js'
import { Unprocessable } from './errors.js'
import { compareOutputsWith, previewWith } from './mapping-preview.js'
import { type Client, ownWorkspace, startTestApi, type TestApi } from './testing.js'
import { CurrentWorkspace } from './workspace.js'

let api: TestApi

let connection: Connection

let admin: Client

let otherAdmin: Client

let viewer: Client

beforeAll(async () => {
  api = await startTestApi()
  ;({ connection, admin, otherAdmin, viewer } = api)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await connection.db.delete(mappings)
  await connection.db.delete(documentStructures)
  await connection.db.delete(lookupTables)
})

const order = {
  orderNumber: 'PO-2026-10417',
  orderDate: '2026-10-02',
  currency: 'EUR',
  note: null,
  buyer: { gln: '4012345000016', name: 'Hansemarkt GmbH', city: 'Lübeck' },
  lines: [
    { lineNumber: 1, gtin: '04012345123456', quantity: 24, netPrice: 1.89, promotion: true },
    { lineNumber: 2, gtin: '04012345654321', quantity: 12.5, netPrice: 3 },
  ],
  tags: ['express'],
}

type Origin = (typeof documentStructureOrigins)[keyof typeof documentStructureOrigins]

const createdMapping = async (
  messageType: string,
  origin: Origin = documentStructureOrigins.jsonDocument,
  target = admin,
) => {
  const structure = await target.inject({
    method: 'POST',
    url: createDocumentStructureEndpoint.path,
    body: { name: 'ERP orders', origin },
  })

  expect(structure.statusCode).toBe(201)

  const response = await target.inject({
    method: 'POST',
    url: createMappingEndpoint.path,
    body: { messageType, documentStructureId: documentStructureSchema.parse(structure.json()).id },
  })

  expect(response.statusCode).toBe(201)

  return {
    mapping: mappingSummarySchema.parse(response.json()),
    structure: documentStructureSchema.parse(structure.json()),
  }
}

const samplesOf = (id: string, target = admin) =>
  target.inject({ method: 'GET', url: toPath(mappingSamplesEndpoint.path, { id }) })

describe('GET /mappings/:id/samples', () => {
  it("answers the Document Structure's sample for an outbound Mapping", async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const response = await samplesOf(mapping.id)

    expect(response.statusCode).toBe(200)
    expect(mappingSampleSchema.array().parse(response.json())).toEqual([
      { id: structure.id, name: 'order.json', document: { format: 'json', content: order } },
    ])
  })

  it('answers no Sample Document for an inbound Mapping', async () => {
    const { mapping } = await createdMapping('ORDERS')

    const response = await samplesOf(mapping.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('answers no Sample Document for a Document Structure made from a JSON Schema', async () => {
    const { mapping } = await createdMapping('INVOIC', documentStructureOrigins.jsonSchema)

    expect((await samplesOf(mapping.id)).json()).toEqual([])
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const { mapping } = await createdMapping('INVOIC', undefined, otherAdmin)

    expect((await samplesOf(mapping.id)).statusCode).toBe(404)
  })
})

const invoice: MappingGraph = {
  links: [
    { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
    { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
    { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
    { sourcePath: 'buyer.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
  ],
  transforms: [],
  transformLinks: [],
}

const invoiceText = [
  "UNH+1+INVOIC:D:96A:UN:EAN008'",
  "BGM++PO-2026-10417'",
  "DTM+137:2026-10-02'",
  "NAD+BY+4012345000016::9'",
  "NAD+SU+4012345000016::9'",
  "CUX+2:EUR:4'",
  "UNS+S'",
  "MOA+77'",
  "UNT+9+1'",
].join('\n')

const unknownId = '0b6f1a7e-2c4d-4e8f-9a1b-3c5d7e9f1a2b'

const postLookupTable = async (entries: LookupTableEntry[], target = admin) => {
  const response = await target.inject({
    method: 'POST',
    url: createLookupTableEndpoint.path,
    body: { name: 'Bestellnummern', kind: 'other', scope: { kind: 'workspace' }, entries },
  })

  expect(response.statusCode).toBe(201)

  return lookupTableSchema.parse(response.json()).id
}

const lookupTransformId = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const withOrderNumberLookup = (lookupTableId: string): MappingGraph => ({
  links: invoice.links.filter(({ targetPath }) => targetPath !== 'BGM/1004'),
  transforms: [
    {
      id: lookupTransformId,
      kind: 'lookupTable',
      position: { x: 320, y: 80 },
      config: { lookupTableId, fallback: 'fail' },
    },
  ],
  transformLinks: [
    {
      from: { kind: 'source', path: 'orderNumber' },
      to: { kind: 'transform', transformId: lookupTransformId, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: lookupTransformId, output: 'value' },
      to: { kind: 'target', path: 'BGM/1004' },
    },
  ],
})

const preview = (id: string, body: NonNullable<InjectOptions['body']>, target = admin) =>
  target.inject({ method: 'POST', url: toPath(mappingPreviewEndpoint.path, { id }), body })

describe('POST /mappings/:id/preview', () => {
  it('runs the mapping engine on the Sample Document with the graph it is sent', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const response = await preview(mapping.id, { sampleId: structure.id, graph: invoice })

    expect(response.statusCode).toBe(200)
    expect(mappingPreviewSchema.parse(response.json())).toEqual({
      sampleId: structure.id,
      document: { format: 'edifact', content: invoiceText },
      notes: [],
    })
  })

  it('answers 200 to a Viewer, since a preview changes nothing', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const response = await preview(mapping.id, { sampleId: structure.id, graph: invoice }, viewer)

    expect(response.statusCode).toBe(200)
  })

  it("translates with the Workspace's Lookup Tables", async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const lookupTableId = await postLookupTable([
      { sourceCode: 'PO-2026-10417', targetCode: '10417' },
    ])

    const response = await preview(mapping.id, {
      sampleId: structure.id,
      graph: withOrderNumberLookup(lookupTableId),
    })

    expect(mappingPreviewSchema.parse(response.json())).toEqual({
      sampleId: structure.id,
      document: {
        format: 'edifact',
        content: invoiceText.replace('PO-2026-10417', '10417'),
      },
      notes: [],
    })
  })

  it('answers the error of the engine as a note on an empty target', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const lookupTableId = await postLookupTable([{ sourceCode: 'PO-1', targetCode: '1' }])

    const response = await preview(mapping.id, {
      sampleId: structure.id,
      graph: withOrderNumberLookup(lookupTableId),
    })

    expect(mappingPreviewSchema.parse(response.json())).toEqual({
      sampleId: structure.id,
      document: { format: 'edifact', content: '' },
      notes: [{ targetPath: 'BGM/1004', transformId: lookupTransformId, code: 'noLookupMatch' }],
    })
  })

  it('answers no match for an empty Lookup Table of the Workspace', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const response = await preview(mapping.id, {
      sampleId: structure.id,
      graph: withOrderNumberLookup(await postLookupTable([])),
    })

    expect(mappingPreviewSchema.parse(response.json()).notes).toEqual([
      { targetPath: 'BGM/1004', transformId: lookupTransformId, code: 'noLookupMatch' },
    ])
  })

  it.each([
    [
      'a required value nobody links',
      'missingRequiredValue',
      'SG2+SU/NAD+SU/C082/3039',
      {
        ...invoice,
        links: invoice.links.filter(({ targetPath }) => !targetPath.startsWith('SG2+SU')),
      },
    ],
    [
      'a link to an element the Message Type does not have',
      'brokenLink',
      'BGM/9999',
      {
        ...invoice,
        links: [...invoice.links, { sourcePath: 'currency', targetPath: 'BGM/9999' }],
      },
    ],
  ])('answers a note for %s', async (_, code, targetPath, graph) => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const response = await preview(mapping.id, { sampleId: structure.id, graph })

    expect(mappingPreviewSchema.parse(response.json()).notes).toEqual([
      { targetPath, transformId: null, code },
    ])
  })

  it('does not read the Lookup Tables of another Workspace', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    const foreignTableId = await postLookupTable(
      [{ sourceCode: 'PO-2026-10417', targetCode: '10417' }],
      otherAdmin,
    )

    const response = await preview(mapping.id, {
      sampleId: structure.id,
      graph: withOrderNumberLookup(foreignTableId),
    })

    expect(mappingPreviewSchema.parse(response.json()).notes).toEqual([
      { targetPath: 'BGM/1004', transformId: lookupTransformId, code: 'unknownLookupTable' },
    ])
  })

  it('answers 404 for a sample the Mapping does not have', async () => {
    const { mapping } = await createdMapping('INVOIC')

    const response = await preview(mapping.id, { sampleId: unknownId, graph: invoice })

    expect(response.statusCode).toBe(404)
  })

  it('answers 404 for an inbound Mapping, which has no Sample Document yet', async () => {
    const { mapping, structure } = await createdMapping('ORDERS')

    const response = await preview(mapping.id, { sampleId: structure.id, graph: invoice })

    expect(response.statusCode).toBe(404)
  })

  it('answers 400 for a body without a graph', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')

    expect((await preview(mapping.id, { sampleId: structure.id })).statusCode).toBe(400)
  })

  it('answers 404 for a Mapping of another Workspace', async () => {
    const { mapping, structure } = await createdMapping('INVOIC', undefined, otherAdmin)

    const response = await preview(mapping.id, { sampleId: structure.id, graph: invoice })

    expect(response.statusCode).toBe(404)
  })
})

describe('GET /mappings/:mappingId/comparison with a Sample Document', () => {
  const published = async (mappingId: string, graph: MappingGraph) => {
    const saved = await admin.inject({
      method: 'PUT',
      url: toPath(saveMappingDraftEndpoint.path, { id: mappingId }),
      body: graph,
    })

    expect(saved.statusCode).toBe(200)

    const response = await admin.inject({
      method: 'POST',
      url: toPath(publishMappingDraftEndpoint.path, { mappingId }),
      body: { changeNote: '' },
    })

    expect(response.statusCode).toBe(201)

    return mappingVersionEntrySchema.parse(response.json()).id
  }

  const currencyAsOrderNumber: MappingGraph = {
    ...invoice,
    links: invoice.links.map((link) =>
      link.targetPath === 'BGM/1004' ? { ...link, sourcePath: 'currency' } : link,
    ),
  }

  it('answers the outputs of both versions and how they differ', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')
    const from = await published(mapping.id, invoice)
    const to = await published(mapping.id, currencyAsOrderNumber)

    const response = await admin.inject({
      method: 'GET',
      url: toPath(mappingComparisonEndpoint.path, { mappingId: mapping.id }),
      query: { from, to, sampleId: structure.id },
    })

    expect(response.statusCode).toBe(200)
    expect(mappingComparisonSchema.parse(response.json()).outputs).toEqual({
      sampleId: structure.id,
      from: { document: { format: 'edifact', content: invoiceText }, notes: [] },
      to: {
        document: { format: 'edifact', content: invoiceText.replace('PO-2026-10417', 'EUR') },
        notes: [],
      },
      differences: [{ path: 'BGM/1004', repetitions: [], before: 'PO-2026-10417', after: 'EUR' }],
    })
  })

  const loopTransformId = '8f3e2d1c-0b9a-4c8d-9e7f-000000000001'

  const linesFrom = (sourcePath: string): MappingGraph => ({
    links: [
      ...invoice.links,
      { sourcePath, targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'lines[].quantity', targetPath: 'SG25/QTY+47/C186/6060' },
    ],
    transforms: [
      { id: loopTransformId, kind: 'loop', position: { x: 0, y: 80 }, config: { counterStart: 1 } },
    ],
    transformLinks: [
      {
        from: { kind: 'source', path: 'lines[]' },
        to: { kind: 'transform', transformId: loopTransformId, input: 'items' },
      },
      {
        from: { kind: 'transform', transformId: loopTransformId, output: 'items' },
        to: { kind: 'target', path: 'SG25' },
      },
    ],
  })

  it('names the repetition of each differing value', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')
    const from = await published(mapping.id, linesFrom('lines[].gtin'))
    const to = await published(mapping.id, linesFrom('lines[].lineNumber'))

    const response = await admin.inject({
      method: 'GET',
      url: toPath(mappingComparisonEndpoint.path, { mappingId: mapping.id }),
      query: { from, to, sampleId: structure.id },
    })

    expect(mappingComparisonSchema.parse(response.json()).outputs?.differences).toEqual([
      { path: 'SG25/LIN/C212/7140', repetitions: [0], before: '04012345123456', after: '1' },
      { path: 'SG25/LIN/C212/7140', repetitions: [1], before: '04012345654321', after: '2' },
    ])
  })

  it('answers no match for an empty Lookup Table of the Workspace', async () => {
    const { mapping, structure } = await createdMapping('INVOIC')
    const from = await published(mapping.id, invoice)
    const to = await published(mapping.id, withOrderNumberLookup(await postLookupTable([])))

    const response = await admin.inject({
      method: 'GET',
      url: toPath(mappingComparisonEndpoint.path, { mappingId: mapping.id }),
      query: { from, to, sampleId: structure.id },
    })

    expect(mappingComparisonSchema.parse(response.json()).outputs?.to.notes).toEqual([
      { targetPath: 'BGM/1004', transformId: lookupTransformId, code: 'noLookupMatch' },
    ])
  })

  it('answers 404 for a Sample Document the Mapping does not have', async () => {
    const { mapping } = await createdMapping('INVOIC')
    const from = await published(mapping.id, invoice)
    const to = await published(mapping.id, currencyAsOrderNumber)

    const response = await admin.inject({
      method: 'GET',
      url: toPath(mappingComparisonEndpoint.path, { mappingId: mapping.id }),
      query: { from, to, sampleId: unknownId },
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('an inbound Sample Document, which no route serves until Runs (#187)', () => {
  const ordersText = [
    "UNB+UNOC:3+4012345000016:14+4398765000004:14+261002:1200+1'",
    "UNH+1+ORDERS:D:96A:UN:EAN008'",
    "BGM+220+PO-2026-10417+9'",
    "DTM+137:20261002:102'",
    "UNT+4+1'",
    "UNZ+1+1'",
  ].join('\n')

  const orders: MappingGraph = {
    links: [{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }],
    transforms: [],
    transformLinks: [],
  }

  const sampleId = '2d4f6a8c-1e3b-4d5f-8a7c-9e1b3d5f7a9c'

  const inbound = (content: string) => ({
    mapping: { messageType: 'ORDERS' as const },
    structure: {
      id: sampleId,
      name: 'ERP orders',
      format: 'json' as const,
      root: 'object' as const,
      sample: null,
      children: [
        {
          path: 'orderNumber',
          name: 'orderNumber',
          label: 'Order number',
          labelReason: null,
          labelUnsure: false,
          required: true,
          kind: 'field' as const,
          type: 'string' as const,
        },
      ],
    },
    samples: [
      { id: sampleId, name: 'orders.edi', document: { format: 'edifact' as const, content } },
    ],
  })

  const run = <A, E>(effect: Effect.Effect<A, E, Db | CurrentWorkspace>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(Db, connection.db),
        Effect.provideService(CurrentWorkspace, { id: ownWorkspace.id }),
      ),
    )

  it('previews the Document the engine writes from the Message', async () => {
    expect(await run(previewWith(inbound(ordersText), { sampleId, graph: orders }))).toEqual({
      sampleId,
      document: { format: 'json', content: { orderNumber: 'PO-2026-10417' } },
      notes: [],
    })
  })

  it('compares the Documents of two versions', async () => {
    const after = {
      ...orders,
      links: [{ sourcePath: 'DTM+137/C507/2380', targetPath: 'orderNumber' }],
    }

    const outputs = await run(compareOutputsWith(inbound(ordersText), sampleId, orders, after))

    expect(outputs.differences).toEqual([
      { path: 'orderNumber', repetitions: [], before: 'PO-2026-10417', after: '20261002' },
    ])
  })

  it('leaves the Document empty with a note when the engine stops', async () => {
    const broken = { ...orders, links: [{ sourcePath: 'BGM/9999', targetPath: 'orderNumber' }] }

    expect(await run(previewWith(inbound(ordersText), { sampleId, graph: broken }))).toEqual({
      sampleId,
      document: { format: 'json', content: {} },
      notes: [{ targetPath: 'orderNumber', transformId: null, code: 'brokenLink' }],
    })
  })

  it.each(['', "UNB+UNOC:3+4012345000016:14+4398765000004:14+261002:1200+1'UNZ+0+1'"])(
    'refuses a Sample Document that holds no Message: %j',
    async (content) => {
      const loaded = inbound(content)

      expect(
        await run(Effect.flip(previewWith(loaded, { sampleId, graph: orders }))),
      ).toBeInstanceOf(Unprocessable)
      expect(
        await run(Effect.flip(compareOutputsWith(loaded, sampleId, orders, orders))),
      ).toBeInstanceOf(Unprocessable)
    },
  )
})
