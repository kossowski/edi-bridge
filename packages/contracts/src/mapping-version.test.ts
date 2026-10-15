import { describe, expect, it } from 'vitest'

import {
  byNameAndNewest,
  type MappingComparison,
  mappingComparisonQuerySchema,
  mappingComparisonSchema,
  type MappingDifference,
  mappingDifferences,
  mappingDifferenceSchema,
  type MappingVersion,
  mappingVersionSchema,
  type MappingVersionSummary,
  outputDifferenceSchema,
} from './mapping-version'

import type { MappingTransform } from './transform'

const mappingId = '00000007-0000-4000-8000-000000000001'

const first: MappingVersionSummary = {
  id: '0000000b-0000-4000-8000-000000000001',
  mappingId,
  mappingName: 'Hansemarkt: ERP JSON to DESADV',
  version: 1,
  publishedAt: '2026-08-03T09:00:00.000Z',
}

const second: MappingVersionSummary = {
  ...first,
  id: '0000000b-0000-4000-8000-000000000002',
  version: 2,
  publishedAt: '2026-09-14T09:00:00.000Z',
}

const version: MappingVersion = {
  ...second,
  direction: 'outbound',
  source: {
    kind: 'documentStructure',
    documentStructureId: '00000006-0000-4000-8000-000000000002',
    name: 'ERP dispatch advice',
  },
  target: { kind: 'messageType', messageType: 'DESADV' },
  links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
  transforms: [],
  transformLinks: [],
}

describe('byNameAndNewest', () => {
  it('sorts by Mapping name in German order, then newest version first', () => {
    const umlaut = { ...first, mappingName: 'Ölmühle: ERP JSON to ORDERS' }
    const plain = { ...first, mappingName: 'Pfalzmarkt: ERP JSON to ORDERS' }

    expect([plain, first, umlaut, second].toSorted(byNameAndNewest)).toEqual([
      second,
      first,
      umlaut,
      plain,
    ])
  })
})

describe('mappingVersionSchema', () => {
  it('accepts a published version with its sides and graph', () => {
    expect(mappingVersionSchema.parse(version)).toEqual(version)
  })

  it('maps a Document Structure to a Message Type outbound, never the other way round', () => {
    const swapped = { ...version, source: version.target, target: version.source }

    expect(mappingVersionSchema.safeParse(swapped).success).toBe(false)
  })

  it('rejects a graph that links a target twice', () => {
    const links = [...version.links, { sourcePath: 'orderNumber', targetPath: 'BGM/1004' }]

    expect(mappingVersionSchema.safeParse({ ...version, links }).success).toBe(false)
  })
})

const substring: MappingTransform = {
  id: '0000000a-0000-4000-8000-000000000001',
  kind: 'substring',
  position: { x: 0, y: 0 },
  config: { start: 0, length: 35 },
}

const link = { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }

const transformLink = {
  from: { kind: 'source', path: 'shipTo.street' },
  to: { kind: 'transform', transformId: substring.id, input: 'value' },
} as const

describe('mappingDifferenceSchema', () => {
  it.each<MappingDifference>([
    { kind: 'link', change: 'added', before: null, after: link },
    { kind: 'link', change: 'removed', before: link, after: null },
    {
      kind: 'link',
      change: 'changed',
      before: link,
      after: { ...link, sourcePath: 'orderNumber' },
    },
    {
      kind: 'transform',
      change: 'changed',
      before: substring,
      after: { ...substring, config: { start: 0, length: 30 } },
    },
    { kind: 'transformLink', change: 'added', before: null, after: transformLink },
  ])('accepts a $kind that was $change', (difference) => {
    expect(mappingDifferenceSchema.parse(difference)).toEqual(difference)
  })

  it.each([
    { kind: 'link', change: 'added', before: link, after: link },
    { kind: 'link', change: 'removed', before: null, after: null },
    { kind: 'transform', change: 'changed', before: null, after: substring },
  ])('rejects a $change $kind whose before and after do not fit the change', (difference) => {
    expect(mappingDifferenceSchema.safeParse(difference).success).toBe(false)
  })

  it('rejects a changed transform link, since a different link is another link', () => {
    const difference = {
      kind: 'transformLink',
      change: 'changed',
      before: transformLink,
      after: transformLink,
    }

    expect(mappingDifferenceSchema.safeParse(difference).success).toBe(false)
  })
})

describe('mappingDifferences', () => {
  const otherLink = { sourcePath: 'orderNumber', targetPath: 'BGM/1225' }

  const graph = {
    links: [link, otherLink],
    transforms: [substring],
    transformLinks: [transformLink],
  }

  it('finds no difference in moved transforms or reordered parts', () => {
    const moved = {
      links: [otherLink, link],
      transforms: [{ ...substring, position: { x: 240, y: 120 } }],
      transformLinks: [transformLink],
    }

    expect(mappingDifferences(graph, moved)).toEqual([])
  })

  it('lists added, removed and changed parts', () => {
    const shorter = { ...substring, config: { start: 0, length: 30 } }

    const after = {
      links: [{ ...link, sourcePath: 'orderNumber' }],
      transforms: [shorter],
      transformLinks: [],
    }

    expect(mappingDifferences(graph, after)).toEqual([
      { kind: 'link', change: 'changed', before: link, after: after.links[0] },
      { kind: 'link', change: 'removed', before: otherLink, after: null },
      { kind: 'transform', change: 'changed', before: substring, after: shorter },
      { kind: 'transformLink', change: 'removed', before: transformLink, after: null },
    ])
  })
})

describe('outputDifferenceSchema', () => {
  it('accepts a value that appears, changes or disappears', () => {
    const differences = [
      { path: 'BGM/1004', repetitions: [], before: null, after: 'DN-1' },
      { path: 'SG10/CPS/7164', repetitions: [1], before: '1', after: '2' },
      { path: 'FTX+AAI/C108/4440', repetitions: [], before: 'Note', after: null },
    ]

    expect(differences.map((difference) => outputDifferenceSchema.parse(difference))).toEqual(
      differences,
    )
  })

  it('rejects a difference that keeps the value', () => {
    const same = { path: 'BGM/1004', repetitions: [], before: 'DN-1', after: 'DN-1' }

    expect(outputDifferenceSchema.safeParse(same).success).toBe(false)
  })
})

const comparison: MappingComparison = {
  mappingId,
  from: first,
  to: second,
  differences: [{ kind: 'link', change: 'added', before: null, after: link }],
  outputs: {
    sampleId: '0000000c-0000-4000-8000-000000000001',
    from: { document: { format: 'edifact', content: "BGM+351'" }, notes: [] },
    to: { document: { format: 'edifact', content: "BGM+351+DN-1'" }, notes: [] },
    differences: [{ path: 'BGM/1004', repetitions: [], before: null, after: 'DN-1' }],
  },
}

describe('mappingComparisonSchema', () => {
  it('accepts two versions of the Mapping with their differences and outputs', () => {
    expect(mappingComparisonSchema.parse(comparison)).toEqual(comparison)
  })

  it('accepts a comparison without outputs', () => {
    const withoutOutputs = { ...comparison, outputs: null }

    expect(mappingComparisonSchema.parse(withoutOutputs)).toEqual(withoutOutputs)
  })

  it('rejects a version of another Mapping', () => {
    const other = { ...second, mappingId: '00000007-0000-4000-8000-000000000002' }

    expect(mappingComparisonSchema.safeParse({ ...comparison, to: other }).success).toBe(false)
  })

  it('rejects comparing a version with itself', () => {
    expect(mappingComparisonSchema.safeParse({ ...comparison, to: first }).success).toBe(false)
  })
})

describe('mappingComparisonQuerySchema', () => {
  it('takes two versions and an optional Sample Document', () => {
    expect(mappingComparisonQuerySchema.parse({ from: first.id, to: second.id })).toEqual({
      from: first.id,
      to: second.id,
    })
  })

  it('rejects the same version on both sides', () => {
    expect(mappingComparisonQuerySchema.safeParse({ from: first.id, to: first.id }).success).toBe(
      false,
    )
  })
})
