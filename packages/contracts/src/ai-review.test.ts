import { describe, expect, it } from 'vitest'

import {
  acceptedAiReview,
  aiReviewKeys,
  type AiReview,
  marksAll,
  remainingAiReview,
  transformLinkKey,
} from './ai-review'

import type { GraphParts } from './mapping'
import type { MappingTransform, TransformLink } from './transform'

const dateFormat: MappingTransform = {
  id: '0000000a-0000-4000-8000-000000000001',
  kind: 'dateFormat',
  position: { x: 0, y: 0 },
  config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
}

const intoDateFormat: TransformLink = {
  from: { kind: 'source', path: 'documentDate' },
  to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
}

const outOfDateFormat: TransformLink = {
  from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
  to: { kind: 'target', path: 'DTM+137/C507/2380' },
}

const proposed: GraphParts = {
  links: [
    { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' },
    { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
  ],
  transforms: [dateFormat],
  transformLinks: [intoDateFormat, outOfDateFormat],
}

const review: AiReview = {
  sampleId: '00000008-0000-4000-8000-000000000001',
  proposedLinks: ['BGM/1004', 'SG2+BY/NAD+BY/C082/3039'],
  proposedTransforms: [dateFormat.id],
  proposedTransformLinks: [`input:${dateFormat.id}/value`, 'target:DTM+137/C507/2380'],
}

describe('transformLinkKey', () => {
  it('names a transform link by the target element or transform input it ends at', () => {
    expect(transformLinkKey(intoDateFormat)).toBe(`input:${dateFormat.id}/value`)
    expect(transformLinkKey(outOfDateFormat)).toBe('target:DTM+137/C507/2380')
  })
})

describe('aiReviewKeys', () => {
  it('keys links by target path, transforms by id and transform links by where they end', () => {
    expect(aiReviewKeys(proposed)).toEqual({
      links: review.proposedLinks,
      transforms: review.proposedTransforms,
      transformLinks: review.proposedTransformLinks,
    })
  })
})

describe('remainingAiReview', () => {
  it('keeps every mark while the AI-proposed parts stay as they are', () => {
    expect(remainingAiReview(review, proposed, proposed)).toEqual(review)
  })

  it('drops the mark of a rejected link', () => {
    const after = { ...proposed, links: proposed.links.slice(1) }

    expect(remainingAiReview(review, proposed, after).proposedLinks).toEqual([
      'SG2+BY/NAD+BY/C082/3039',
    ])
  })

  it('drops the mark of a link that now starts at another source field', () => {
    const after = {
      ...proposed,
      links: [{ sourcePath: 'orderNumber', targetPath: 'BGM/1004' }, proposed.links[1]!],
    }

    expect(remainingAiReview(review, proposed, after).proposedLinks).toEqual([
      'SG2+BY/NAD+BY/C082/3039',
    ])
  })

  it('drops the mark of a reconfigured transform but keeps it for a moved one', () => {
    const moved = { ...dateFormat, position: { x: 240, y: 120 } }
    const reconfigured = { ...dateFormat, config: { from: 'dd.MM.yyyy', to: 'yyyyMMdd' } }

    expect(
      remainingAiReview(review, proposed, { ...proposed, transforms: [moved] }).proposedTransforms,
    ).toEqual([dateFormat.id])
    expect(
      remainingAiReview(review, proposed, { ...proposed, transforms: [reconfigured] })
        .proposedTransforms,
    ).toEqual([])
  })

  it('drops the mark of a transform link that now starts elsewhere', () => {
    const after = {
      ...proposed,
      transformLinks: [
        { ...intoDateFormat, from: { kind: 'source', path: 'despatchDate' } } as const,
        outOfDateFormat,
      ],
    }

    expect(remainingAiReview(review, proposed, after).proposedTransformLinks).toEqual([
      'target:DTM+137/C507/2380',
    ])
  })

  it('never marks a part the Admin added', () => {
    const after = {
      ...proposed,
      links: [...proposed.links, { sourcePath: 'note', targetPath: 'FTX+AAI/C108/4440' }],
    }

    expect(remainingAiReview(review, proposed, after)).toEqual(review)
  })
})

describe('acceptedAiReview', () => {
  it('drops the marks of the accepted parts and keeps the others', () => {
    expect(
      acceptedAiReview(review, {
        links: ['BGM/1004'],
        transforms: [dateFormat.id],
        transformLinks: [`input:${dateFormat.id}/value`, 'target:DTM+137/C507/2380'],
      }),
    ).toEqual({
      sampleId: review.sampleId,
      proposedLinks: ['SG2+BY/NAD+BY/C082/3039'],
      proposedTransforms: [],
      proposedTransformLinks: [],
    })
  })

  it('closes the review once nothing proposed is left', () => {
    expect(
      acceptedAiReview(review, {
        links: ['BGM/1004', 'SG2+BY/NAD+BY/C082/3039'],
        transforms: [dateFormat.id],
        transformLinks: [`input:${dateFormat.id}/value`, 'target:DTM+137/C507/2380'],
      }),
    ).toBeNull()
  })
})

describe('marksAll', () => {
  it('holds only when the review marks every given part', () => {
    expect(
      marksAll(review, { links: ['BGM/1004'], transforms: [dateFormat.id], transformLinks: [] }),
    ).toBe(true)

    expect(
      marksAll(review, { links: ['BGM/1004', 'FTX/4440'], transforms: [], transformLinks: [] }),
    ).toBe(false)
  })
})
