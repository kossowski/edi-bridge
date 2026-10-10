import { describe, expect, it } from 'vitest'

import {
  mappingPreviewEndpoint,
  mappingPreviewSchema,
  mappingSamplesEndpoint,
  previewMappingBodySchema,
} from './mapping-preview'

const sampleId = '0000000a-0000-4000-8000-000000000001'

const graph = {
  links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
  transforms: [],
  transformLinks: [],
}

describe('mappingSamplesEndpoint', () => {
  it('lists JSON samples for a Document Structure and EDIFACT samples for a Message Type', () => {
    const samples = [
      {
        id: sampleId,
        name: 'Despatch advice DN-2026-0417',
        document: { format: 'json', content: { despatchNumber: 'DN-2026-0417', packages: [] } },
      },
      {
        id: '0000000a-0000-4000-8000-000000000002',
        name: 'Order HM-2026-10417',
        document: { format: 'edifact', content: "UNH+1+ORDERS:D:96A:UN:EAN008'" },
      },
    ]

    expect(mappingSamplesEndpoint.response.parse(samples)).toEqual(samples)
  })

  it('rejects a sample without a name', () => {
    const sample = { id: sampleId, name: '', document: { format: 'json', content: {} } }

    expect(mappingSamplesEndpoint.response.safeParse([sample]).success).toBe(false)
  })
})

describe('previewMappingBodySchema', () => {
  it('takes the chosen sample and the current graph', () => {
    expect(previewMappingBodySchema.parse({ sampleId, graph })).toEqual({ sampleId, graph })
    expect(mappingPreviewEndpoint.method).toBe('POST')
  })

  it('checks the graph like a Draft save does', () => {
    const twice = { ...graph, links: [...graph.links, graph.links[0]!] }

    expect(previewMappingBodySchema.safeParse({ sampleId, graph: twice }).success).toBe(false)
  })
})

describe('mappingPreviewSchema', () => {
  it('returns the target Document with notes on targets the preview left empty', () => {
    const preview = {
      sampleId,
      document: { format: 'edifact', content: "UNH+1+DESADV:D:96A:UN:EAN007'\nBGM+351+DN-1'" },
      notes: [
        {
          targetPath: 'SG2+DP/NAD+DP/3207',
          transformId: '0000000b-0000-4000-8000-000000000001',
          code: 'invalidTransform',
        },
      ],
    }

    expect(mappingPreviewSchema.parse(preview)).toEqual(preview)
  })

  it('knows only its own note codes', () => {
    const preview = {
      sampleId,
      document: { format: 'json', content: {} },
      notes: [{ targetPath: 'orderNumber', transformId: null, code: 'somethingElse' }],
    }

    expect(mappingPreviewSchema.safeParse(preview).success).toBe(false)
  })
})
