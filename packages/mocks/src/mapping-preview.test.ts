import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  glnIssue,
  type DocumentContent,
  type JsonContent,
  jsonContentSchema,
  type MappingGraph,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  type PreviewMappingBody,
  toPath,
} from '@edi-bridge/contracts'

import { documentStructureLeaves, seedDocumentStructureOf } from './document-structure'
import { seedMappingDrafts } from './mapping'
import { mappingPreviewHandlers } from './mapping-preview'
import { createMappingSample } from './mapping-sample'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

function seeded(name: string) {
  return seedMappingDrafts.find((mapping) => mapping.name === name)!
}

const hansemarktDesadv = seeded('Hansemarkt: ERP JSON to DESADV')

const hansemarktOrders = seeded('Hansemarkt: ORDERS to ERP JSON')

const hansemarktInvoic = seeded('Hansemarkt: ERP JSON to INVOIC')

const unpublished = seedMappingDrafts.find(({ latestVersion }) => latestVersion === null)!

async function listSamples(id: string) {
  return fetch(`${apiUrl}${toPath(mappingSamplesEndpoint.path, { id })}`)
}

async function samplesOf(id: string) {
  return mappingSamplesEndpoint.response.parse(await (await listSamples(id)).json())
}

const objectSchema = z.record(z.string(), jsonContentSchema)

// Collects the structure paths a JSON Document fills, e.g. `packages[].lines[].gtin`.
function jsonPaths(value: JsonContent, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => jsonPaths(item, `${path}[]`))
  }

  const object = objectSchema.safeParse(value)

  if (object.success) {
    return Object.entries(object.data).flatMap(([key, child]) =>
      jsonPaths(child, path === '' ? key : `${path}.${key}`),
    )
  }

  return [path]
}

function edifactText(document: DocumentContent) {
  if (document.format !== 'edifact') {
    throw new Error(`Expected EDIFACT, got ${document.format}`)
  }

  return document.content
}

function glnsIn(text: string) {
  return [...text.matchAll(/\b\d{13}\b/g)].map(([gln]) => gln)
}

describe('GET /mappings/:id/samples', () => {
  it('lists JSON samples that fit the Document Structure of an outbound Mapping', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const samples = await samplesOf(hansemarktDesadv.id)

    const fields = new Set(
      documentStructureLeaves(seedDocumentStructureOf.DESADV).map(({ path }) => path),
    )

    expect(samples.length).toBeGreaterThan(0)

    for (const { document } of samples) {
      expect(document.format).toBe('json')

      const paths = jsonPaths(document.content)

      expect(paths.filter((path) => !fields.has(path))).toEqual([])
      expect(paths).toContain('packages[].lines[].gtin')

      for (const gln of glnsIn(JSON.stringify(document.content))) {
        expect(glnIssue(gln)).toBeNull()
        expect(gln).toMatch(/^02\d/)
      }
    }
  })

  it('lists the raw EDIFACT an inbound Mapping receives, one segment per line', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktOrders.id)

    const lines = edifactText(sample!.document).split('\n')

    expect(lines[0]).toBe("UNA:+.? '")
    expect(lines).toContainEqual(expect.stringMatching(/^UNH\+\d+\+ORDERS:D:96A:UN'$/))
    expect(lines).toContainEqual(expect.stringMatching(/^BGM\+220\+PO-2026-\d{5}'$/))
    expect(lines.filter((line) => line.startsWith('LIN+'))).toHaveLength(3)
    expect(lines.every((line) => line.endsWith("'"))).toBe(true)

    for (const gln of glnsIn(edifactText(sample!.document))) {
      expect(glnIssue(gln)).toBeNull()
    }
  })

  it('lists no samples for a Draft that has none yet', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))

    await expect(samplesOf(unpublished.id)).resolves.toEqual([])
  })

  it('answers 404 for an unknown Mapping', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))

    expect((await listSamples('00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })
})

async function requestPreview(id: string, body: Partial<PreviewMappingBody>) {
  return fetch(`${apiUrl}${toPath(mappingPreviewEndpoint.path, { id })}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function previewOf(id: string, sampleId: string, graph: Partial<MappingGraph>) {
  const response = await requestPreview(id, {
    sampleId,
    graph: { links: [], transforms: [], transformLinks: [], ...graph },
  })

  return mappingPreviewEndpoint.response.parse(await response.json())
}

function edifactLines(preview: { document: DocumentContent }) {
  return edifactText(preview.document).split('\n')
}

describe('POST /mappings/:id/preview', () => {
  it('copies linked values of the chosen sample into the target Document', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktDesadv.id)

    const { despatchNumber } = z
      .object({ despatchNumber: z.string() })
      .parse(sample!.document.content)

    const preview = await previewOf(hansemarktDesadv.id, sample!.id, {
      links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
    })

    expect(preview.sampleId).toBe(sample!.id)
    expect(edifactLines(preview)).toEqual([
      "UNH+1+DESADV:D:96A:UN'",
      `BGM+351+${despatchNumber}'`,
      "UNT+3+1'",
    ])
    expect(preview.notes).toEqual([])
  })

  it('fills one item per line of an inbound sample and notes the invalid transforms', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktOrders.id)
    const { links, transforms, transformLinks } = hansemarktOrders
    const orderNumber = /^BGM\+220\+(.+)'$/m.exec(edifactText(sample!.document))![1]
    const jsonataNode = transforms.find(({ kind }) => kind === 'jsonata')!

    const preview = await previewOf(hansemarktOrders.id, sample!.id, {
      links: [...links],
      transforms: [...transforms],
      transformLinks: [...transformLinks],
    })

    expect(preview.document.format).toBe('json')

    const content = z
      .object({
        orderNumber: z.string(),
        lines: z.array(z.object({ lineNumber: z.number(), gtin: z.string() })),
      })
      .parse(preview.document.content)

    expect(content.orderNumber).toBe(orderNumber)
    expect(content.lines.map(({ lineNumber }) => lineNumber)).toEqual([1, 2, 3])
    expect(content.lines.every(({ gtin }) => /^02\d{11}$/.test(gtin))).toBe(true)
    expect(preview.notes).toContainEqual({
      targetPath: 'lines[].buyerArticleNumber',
      transformId: jsonataNode.id,
      code: 'invalidTransform',
    })
  })

  it('applies the transforms of the graph to an outbound sample', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [invoice, creditNote] = await samplesOf(hansemarktInvoic.id)
    const { links, transforms, transformLinks } = hansemarktInvoic

    const graph = {
      links: [...links],
      transforms: [...transforms],
      transformLinks: [...transformLinks],
    }

    const numberFormat = transforms.find(({ kind }) => kind === 'numberFormat')!

    const invoiceLines = edifactLines(await previewOf(hansemarktInvoic.id, invoice!.id, graph))
    const creditNotePreview = await previewOf(hansemarktInvoic.id, creditNote!.id, graph)
    const { invoiceDate } = z.object({ invoiceDate: z.string() }).parse(invoice!.document.content)

    expect(invoiceLines).toContainEqual(expect.stringMatching(/^BGM\+380\+INV-2026-\d{5}'$/))
    expect(edifactLines(creditNotePreview)).toContainEqual(
      expect.stringMatching(/^BGM\+381\+CN-2026-\d{5}'$/),
    )
    expect(invoiceLines).toContain(`DTM+137:${invoiceDate.replaceAll('-', '')}:102'`)
    expect(invoiceLines.filter((line) => line.startsWith('LIN+'))).toEqual([
      expect.stringMatching(/^LIN\+1\+\d{13}:EN'$/),
      expect.stringMatching(/^LIN\+2\+\d{13}:EN'$/),
      expect.stringMatching(/^LIN\+3\+\d{13}:EN'$/),
    ])
    expect(creditNotePreview.notes).toContainEqual({
      targetPath: 'SG48/MOA+77/C516/5004',
      transformId: numberFormat.id,
      code: 'invalidTransform',
    })
  })

  it('notes that a JSONata node is not previewed on an EDIFACT source', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktOrders.id)
    const id = '0000000b-0000-4000-8000-000000000001'

    const preview = await previewOf(hansemarktOrders.id, sample!.id, {
      transforms: [
        { id, kind: 'jsonata', position: { x: 0, y: 0 }, config: { expression: '$now()' } },
      ],
      transformLinks: [
        {
          from: { kind: 'transform', transformId: id, output: 'value' },
          to: { kind: 'target', path: 'note' },
        },
      ],
    })

    expect(preview.notes).toEqual([
      { targetPath: 'note', transformId: id, code: 'expressionNotPreviewed' },
    ])
  })

  it('previews a large sample line by line', async () => {
    const documentStructure = seedDocumentStructureOf.DESADV

    const large = createMappingSample({
      mapping: hansemarktDesadv,
      documentStructure,
      lineCount: 2000,
    })

    server.use(...mappingPreviewHandlers(apiUrl, { samples: [large] }))

    const preview = await previewOf(hansemarktDesadv.id, large.id, {
      links: [{ sourcePath: 'packages[].lines[].gtin', targetPath: 'SG10/SG17/LIN/C212/7140' }],
    })

    expect(edifactLines(preview).filter((line) => line.startsWith('LIN+'))).toHaveLength(2000)
  })

  it('rejects a body without a valid graph', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktDesadv.id)

    const { status } = await requestPreview(hansemarktDesadv.id, { sampleId: sample!.id })

    expect(status).toBe(400)
  })

  it('answers 404 for a sample of another Mapping', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktOrders.id)

    const { status } = await requestPreview(hansemarktDesadv.id, {
      sampleId: sample!.id,
      graph: { links: [], transforms: [], transformLinks: [] },
    })

    expect(status).toBe(404)
  })

  it('skips links to paths the sides do not have and notes their targets', async () => {
    server.use(...mappingPreviewHandlers(apiUrl))
    const [sample] = await samplesOf(hansemarktDesadv.id)
    const id = '0000000b-0000-4000-8000-000000000002'

    const { despatchNumber } = z
      .object({ despatchNumber: z.string() })
      .parse(sample!.document.content)

    const response = await requestPreview(hansemarktDesadv.id, {
      sampleId: sample!.id,
      graph: {
        links: [
          { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' },
          { sourcePath: 'noSuchField', targetPath: 'DTM+137/C507/2380' },
          { sourcePath: 'despatchNumber', targetPath: 'NO/SUCH' },
        ],
        transforms: [
          { id, kind: 'substring', position: { x: 0, y: 0 }, config: { start: 0, length: 3 } },
        ],
        transformLinks: [
          {
            from: { kind: 'source', path: 'noSuchField' },
            to: { kind: 'transform', transformId: id, input: 'value' },
          },
          {
            from: { kind: 'transform', transformId: id, output: 'value' },
            to: { kind: 'target', path: 'SG10/SG17/LIN/C212/7140' },
          },
        ],
      },
    })

    expect(response.status).toBe(200)

    const preview = mappingPreviewEndpoint.response.parse(await response.json())

    expect(edifactLines(preview)).toContain(`BGM+351+${despatchNumber}'`)
    expect(preview.notes).toEqual([
      { targetPath: 'DTM+137/C507/2380', transformId: null, code: 'brokenLink' },
      { targetPath: 'NO/SUCH', transformId: null, code: 'brokenLink' },
      { targetPath: 'SG10/SG17/LIN/C212/7140', transformId: id, code: 'brokenLink' },
    ])
  })
})
