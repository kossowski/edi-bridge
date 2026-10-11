import { describe, expect, it } from 'vitest'

import type { AiReview, TransformLink } from '@edi-bridge/contracts'

import { aiMarks, aiProposedCount, rowLinkProposed } from './ai-marks'

const transformId = '0b8d5d1e-7f4e-4d6b-9a39-2a8f4c1f5e21'

const intoInput: TransformLink = {
  from: { kind: 'source', path: 'invoiceDate' },
  to: { kind: 'transform', transformId, input: 'value' },
}

const intoTarget: TransformLink = {
  from: { kind: 'transform', transformId, output: 'value' },
  to: { kind: 'target', path: 'DTM+137/C507/2380' },
}

const review: AiReview = {
  sampleId: '6f1c2a4e-1b2d-4c3e-8f9a-0b1c2d3e4f50',
  proposedLinks: ['BGM/1004'],
  proposedTransforms: [transformId],
  proposedTransformLinks: [`input:${transformId}/value`],
}

describe('aiMarks', () => {
  const marks = aiMarks(review)

  it('marks the AI-proposed parts while the review is open', () => {
    expect(marks.open).toBe(true)
    expect(marks.link({ targetPath: 'BGM/1004' })).toBe(true)
    expect(marks.transform(transformId)).toBe(true)
    expect(marks.transformLink(intoInput)).toBe(true)
  })

  it('leaves the parts the Admin made, rejected or edited unmarked', () => {
    expect(marks.link({ targetPath: 'DTM+137/C507/2380' })).toBe(false)
    expect(marks.transformLink(intoTarget)).toBe(false)
    expect(marks.transform('d2c4e7a1-0000-4000-8000-000000000000')).toBe(false)
  })

  it('tells an end whose link is AI-proposed', () => {
    expect(marks.end({ kind: 'target', path: 'BGM/1004' })).toBe(true)
    expect(marks.end({ kind: 'transform', transformId, input: 'value' })).toBe(true)
    expect(marks.end(intoTarget.to)).toBe(false)
  })

  it('marks nothing without an open review', () => {
    const none = aiMarks(null)

    expect(none.open).toBe(false)
    expect(none.link({ targetPath: 'BGM/1004' })).toBe(false)
    expect(none.transform(transformId)).toBe(false)
  })
})

describe('rowLinkProposed', () => {
  const marks = aiMarks(review)

  it('reads plain links and transform links alike', () => {
    expect(
      rowLinkProposed(marks, {
        kind: 'link',
        link: { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      }),
    ).toBe(true)
    expect(rowLinkProposed(marks, { kind: 'transformLink', link: intoTarget })).toBe(false)
  })
})

describe('aiProposedCount', () => {
  it('counts every marked part', () => {
    expect(aiProposedCount(review)).toBe(3)
    expect(aiProposedCount(null)).toBe(0)
  })
})
