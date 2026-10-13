import { describe, expect, it } from 'vitest'

import type { Graph } from '@/components/mappings/mapping-graph'
import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { AiReview, MappingTransform, PreviewNote, TransformLink } from '@edi-bridge/contracts'

import { aiMarks } from './ai-marks'
import {
  ancestorPaths,
  attentionCount,
  attentionMarks,
  plainProposedLinks,
  proposedChains,
  reviewAttention,
  unmappedRequiredTargets,
} from './ai-review-attention'

function leaf(path: string, required: boolean): TreeItem {
  return {
    path,
    kind: 'element',
    label: path,
    name: null,
    detail: null,
    required,
    repeat: null,
    children: null,
  }
}

function part(path: string, required: boolean, children: TreeItem[]): TreeItem {
  return { ...leaf(path, required), kind: 'segment', children }
}

const target: TreeItem[] = [
  part('BGM', true, [leaf('BGM/1004', true), leaf('BGM/1225', false)]),
  part('DTM+137', true, [leaf('DTM+137/2380', true)]),
  part('FTX', false, [leaf('FTX/4451', true), leaf('FTX/4440', false)]),
  part('NAD+BY', false, [leaf('NAD+BY/3039', true), leaf('NAD+BY/3036', true)]),
]

const lookupId = '0b8d5d1e-7f4e-4d6b-9a39-2a8f4c1f5e21'

const dateId = '1c9e6e2f-8a5f-4e7c-8b4a-3b9a5d2a6f32'

const constantId = '2d0f7f3a-9b6a-4f8d-9c5b-4cab6e3b7a43'

const transforms: MappingTransform[] = [
  {
    id: lookupId,
    kind: 'lookupTable',
    position: { x: 0, y: 0 },
    config: { lookupTableId: null, fallback: 'keepValue' },
  },
  {
    id: dateId,
    kind: 'dateFormat',
    position: { x: 0, y: 0 },
    config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
  },
  {
    id: constantId,
    kind: 'constant',
    position: { x: 0, y: 0 },
    config: { value: '380' },
  },
]

const graph: Graph = {
  links: [
    { sourcePath: 'number', targetPath: 'BGM/1004' },
    { sourcePath: 'buyer.gln', targetPath: 'NAD+BY/3039' },
  ],
  transforms,
  transformLinks: [
    {
      from: { kind: 'source', path: 'date' },
      to: { kind: 'transform', transformId: dateId, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: dateId, output: 'value' },
      to: { kind: 'transform', transformId: lookupId, input: 'value' },
    },
    {
      from: { kind: 'transform', transformId: lookupId, output: 'value' },
      to: { kind: 'target', path: 'DTM+137/2380' },
    },
  ],
}

const review = (parts: Partial<AiReview>): AiReview => ({
  sampleId: '6f1c2a4e-1b2d-4c3e-8f9a-0b1c2d3e4f50',
  proposedLinks: [],
  proposedTransforms: [],
  proposedTransformLinks: [],
  ...parts,
})

describe('unmappedRequiredTargets', () => {
  it('lists required fields left empty in parts that end up in the target Document', () => {
    expect(unmappedRequiredTargets(target, graph).map(({ path }) => path)).toEqual(['NAD+BY/3036'])
  })

  it('counts a required part as present without anything mapped beneath it', () => {
    const empty: Graph = { links: [], transforms: [], transformLinks: [] }

    expect(unmappedRequiredTargets(target, empty).map(({ path }) => path)).toEqual([
      'BGM/1004',
      'DTM+137/2380',
    ])
  })

  it('updates once the Admin maps a field', () => {
    const mapped: Graph = {
      ...graph,
      links: [...graph.links, { sourcePath: 'buyer.name', targetPath: 'NAD+BY/3036' }],
    }

    expect(unmappedRequiredTargets(target, mapped)).toEqual([])
  })
})

describe('unmappedRequiredTargets in EDIFACT', () => {
  const coded = (path: string, codes: string[]): TreeItem => ({
    ...leaf(path, true),
    edifact: { qualifier: null, codes: codes.map((code) => ({ code, meaning: code })) },
  })

  const message = [
    part('UNH', true, [leaf('UNH/0062', true), coded('UNH/S009/0065', ['INVOIC'])]),
    part('BGM', true, [coded('BGM/C002/1001', ['380']), coded('BGM/1225', ['9', '31'])]),
    part('DTM+137', true, [
      { ...leaf('DTM+137/C507/2380', true), label: '2380' },
      { ...leaf('DTM+137/C507/2379', true), label: '2379' },
    ]),
    part('UNT', true, [leaf('UNT/0074', true), leaf('UNT/0062', true)]),
  ]

  it('leaves out what EDI Bridge fills without a link', () => {
    const dated: Graph = {
      links: [{ sourcePath: 'date', targetPath: 'DTM+137/C507/2380' }],
      transforms: [],
      transformLinks: [],
    }

    expect(unmappedRequiredTargets(message, dated).map(({ path }) => path)).toEqual(['BGM/1225'])
  })

  it('still asks for a date format whose date is not mapped', () => {
    const empty: Graph = { links: [], transforms: [], transformLinks: [] }

    expect(unmappedRequiredTargets(message, empty).map(({ path }) => path)).toEqual([
      'BGM/1225',
      'DTM+137/C507/2380',
      'DTM+137/C507/2379',
    ])
  })
})

describe('ancestorPaths', () => {
  it('names the parts above a field, outermost first', () => {
    const nested = [part('SG2', false, [part('SG2/NAD', true, [leaf('SG2/NAD/3039', true)])])]

    expect(ancestorPaths(nested, 'SG2/NAD/3039')).toEqual(['SG2', 'SG2/NAD'])
    expect(ancestorPaths(nested, 'SG2')).toEqual([])
    expect(ancestorPaths(nested, 'unknown')).toEqual([])
  })
})

describe('proposedChains', () => {
  it('follows a target back through every Transform when any part of the chain is proposed', () => {
    const marks = aiMarks(review({ proposedTransforms: [dateId] }))

    expect(proposedChains(graph, marks)).toEqual([
      {
        targetPath: 'DTM+137/2380',
        transformIds: [lookupId, dateId],
        sourcePaths: ['date'],
      },
    ])
  })

  it('leaves chains the Admin made alone and lists a proposed Transform that fills nothing', () => {
    const marks = aiMarks(review({ proposedTransforms: [constantId] }))

    expect(proposedChains(graph, marks)).toEqual([
      { targetPath: null, transformIds: [constantId], sourcePaths: [] },
    ])
  })
})

describe('plainProposedLinks', () => {
  it('keeps only the plain links still marked as proposed', () => {
    const marks = aiMarks(review({ proposedLinks: ['NAD+BY/3039'] }))

    expect(plainProposedLinks(graph, marks)).toEqual([
      { sourcePath: 'buyer.gln', targetPath: 'NAD+BY/3039' },
    ])
  })
})

describe('reviewAttention', () => {
  const notes: PreviewNote[] = [
    { targetPath: 'NAD+BY/3036', transformId: null, code: 'brokenLink' },
    { targetPath: 'DTM+137/2380', transformId: lookupId, code: 'noLookupMatch' },
  ]

  it('sorts each group in the order of the target tree', () => {
    const attention = reviewAttention({
      graph,
      marks: aiMarks(
        review({
          proposedLinks: ['NAD+BY/3039', 'BGM/1004'],
          proposedTransformLinks: [`target:DTM+137/2380`],
        }),
      ),
      targetItems: target,
      notes,
    })

    expect(attention.plain.map(({ targetPath }) => targetPath)).toEqual(['BGM/1004', 'NAD+BY/3039'])
    expect(attention.chains.map(({ targetPath }) => targetPath)).toEqual(['DTM+137/2380'])
    expect(attention.warnings?.map(({ code }) => code)).toEqual(['noLookupMatch', 'brokenLink'])
  })

  it('has no warnings while the preview is not there', () => {
    const attention = reviewAttention({
      graph,
      marks: aiMarks(review({})),
      targetItems: target,
      notes: undefined,
    })

    expect(attention.warnings).toBeUndefined()
    expect(attention.chains).toEqual([])
    expect(attention.plain).toEqual([])
  })
})

describe('attentionCount', () => {
  it('counts unmapped fields, chains and warnings, but not the other proposed links', () => {
    const attention = reviewAttention({
      graph,
      marks: aiMarks(review({ proposedLinks: ['BGM/1004'], proposedTransforms: [dateId] })),
      targetItems: target,
      notes: [{ targetPath: 'NAD+BY/3036', transformId: null, code: 'brokenLink' }],
    })

    expect(attentionCount(attention)).toBe(3)
  })

  it('counts no warnings while the preview is not there', () => {
    const attention = reviewAttention({
      graph,
      marks: aiMarks(review({})),
      targetItems: target,
      notes: undefined,
    })

    expect(attentionCount(attention)).toBe(1)
  })
})

describe('attentionMarks', () => {
  const intoDate: TransformLink = {
    from: { kind: 'source', path: 'date' },
    to: { kind: 'transform', transformId: dateId, input: 'value' },
  }

  const intoLookup: TransformLink = {
    from: { kind: 'transform', transformId: dateId, output: 'value' },
    to: { kind: 'transform', transformId: lookupId, input: 'value' },
  }

  const intoTarget: TransformLink = {
    from: { kind: 'transform', transformId: lookupId, output: 'value' },
    to: { kind: 'target', path: 'DTM+137/2380' },
  }

  it('marks the proposed links of a chain through Transforms', () => {
    const marks = aiMarks(
      review({ proposedTransformLinks: [`input:${lookupId}/value`, 'target:DTM+137/2380'] }),
    )

    const attention = attentionMarks(marks, {
      chains: proposedChains(graph, marks),
      warnings: undefined,
    })

    expect(attention.transformLink(intoLookup)).toBe(true)
    expect(attention.transformLink(intoTarget)).toBe(true)
    expect(attention.transformLink(intoDate)).toBe(false)
  })

  it('marks a plain proposed link only when a warning names its field', () => {
    const marks = aiMarks(review({ proposedLinks: ['BGM/1004', 'NAD+BY/3039'] }))
    const chains = proposedChains(graph, marks)

    const attention = attentionMarks(marks, {
      chains,
      warnings: [{ targetPath: 'NAD+BY/3039', transformId: null, code: 'brokenLink' }],
    })

    expect(attention.link({ targetPath: 'NAD+BY/3039' })).toBe(true)
    expect(attention.link({ targetPath: 'BGM/1004' })).toBe(false)
    expect(
      attentionMarks(marks, { chains, warnings: undefined }).link({ targetPath: 'NAD+BY/3039' }),
    ).toBe(false)
  })

  it('leaves links the Admin made alone, even in a warned chain', () => {
    const marks = aiMarks(review({}))

    const attention = attentionMarks(marks, {
      chains: [],
      warnings: [{ targetPath: 'DTM+137/2380', transformId: lookupId, code: 'noLookupMatch' }],
    })

    expect(attention.transformLink(intoTarget)).toBe(false)
    expect(attention.link({ targetPath: 'DTM+137/2380' })).toBe(false)
  })
})
