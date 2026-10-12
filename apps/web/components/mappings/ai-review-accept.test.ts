import { describe, expect, it } from 'vitest'

import type { Graph } from '@/components/mappings/mapping-graph'
import type { AiReview, MappingTransform, TransformLink } from '@edi-bridge/contracts'

import { aiAcceptParts, reviewAfterAccepting } from './ai-review-accept'

const dateId = '1c9e6e2f-8a5f-4e7c-8b4a-3b9a5d2a6f32'

const lookupId = '0b8d5d1e-7f4e-4d6b-9a39-2a8f4c1f5e21'

const constantId = '2d0f7f3a-9b6a-4f8d-9c5b-4cab6e3b7a43'

const transform = (id: string): MappingTransform => ({
  id,
  kind: 'constant',
  position: { x: 0, y: 0 },
  config: { value: '' },
})

const intoDate: TransformLink = {
  from: { kind: 'source', path: 'date' },
  to: { kind: 'transform', transformId: dateId, input: 'value' },
}

const dateIntoLookup: TransformLink = {
  from: { kind: 'transform', transformId: dateId, output: 'value' },
  to: { kind: 'transform', transformId: lookupId, input: 'value' },
}

const outOfLookup: TransformLink = {
  from: { kind: 'transform', transformId: lookupId, output: 'value' },
  to: { kind: 'target', path: 'DTM+137/2380' },
}

const outOfConstant: TransformLink = {
  from: { kind: 'transform', transformId: constantId, output: 'value' },
  to: { kind: 'target', path: 'BGM/C002/1001' },
}

const graph: Graph = {
  links: [
    { sourcePath: 'number', targetPath: 'BGM/1004' },
    { sourcePath: 'buyer.gln', targetPath: 'NAD+BY/3039' },
  ],
  transforms: [transform(dateId), transform(lookupId), transform(constantId)],
  transformLinks: [intoDate, dateIntoLookup, outOfLookup, outOfConstant],
}

const review: AiReview = {
  sampleId: '6f1c2a4e-1b2d-4c3e-8f9a-0b1c2d3e4f50',
  proposedLinks: ['BGM/1004', 'NAD+BY/3039'],
  proposedTransforms: [dateId, lookupId, constantId],
  proposedTransformLinks: [
    `input:${dateId}/value`,
    `input:${lookupId}/value`,
    'target:DTM+137/2380',
    'target:BGM/C002/1001',
  ],
}

describe('aiAcceptParts', () => {
  it('accepts a plain link on its own', () => {
    expect(aiAcceptParts(review, graph, { kind: 'link', link: graph.links[0]! })).toEqual({
      links: ['BGM/1004'],
      transforms: [],
      transformLinks: [],
    })
  })

  it('accepts a Transform Link together with its whole chain of Transforms and Transform Links', () => {
    const expected = {
      links: [],
      transforms: [dateId, lookupId],
      transformLinks: [`input:${dateId}/value`, `input:${lookupId}/value`, 'target:DTM+137/2380'],
    }

    for (const link of [intoDate, dateIntoLookup, outOfLookup]) {
      expect(aiAcceptParts(review, graph, { kind: 'transformLink', link })).toEqual(expected)
    }
  })

  it('leaves out the parts of the chain the review no longer marks', () => {
    const edited = {
      ...review,
      proposedTransforms: [dateId, constantId],
      proposedTransformLinks: [`input:${dateId}/value`, 'target:BGM/C002/1001'],
    }

    expect(aiAcceptParts(edited, graph, { kind: 'transformLink', link: outOfLookup })).toEqual({
      links: [],
      transforms: [dateId],
      transformLinks: [`input:${dateId}/value`],
    })
  })

  it('accepts nothing for a link the review does not mark', () => {
    const added = { sourcePath: 'note', targetPath: 'FTX/4440' }

    expect(
      aiAcceptParts(
        review,
        { ...graph, links: [...graph.links, added] },
        { kind: 'link', link: added },
      ),
    ).toEqual({ links: [], transforms: [], transformLinks: [] })
  })
})

describe('reviewAfterAccepting', () => {
  it('keeps the marks of the parts outside the accepted chain', () => {
    expect(
      reviewAfterAccepting(review, graph, { kind: 'transformLink', link: outOfConstant }),
    ).toEqual({
      ...review,
      proposedTransforms: [dateId, lookupId],
      proposedTransformLinks: [
        `input:${dateId}/value`,
        `input:${lookupId}/value`,
        'target:DTM+137/2380',
      ],
    })
  })

  it('closes the review once the last proposed link is accepted', () => {
    const lastLink = {
      ...review,
      proposedLinks: ['NAD+BY/3039'],
      proposedTransforms: [],
      proposedTransformLinks: [],
    }

    expect(
      reviewAfterAccepting(lastLink, graph, { kind: 'link', link: graph.links[1]! }),
    ).toBeNull()
  })
})
