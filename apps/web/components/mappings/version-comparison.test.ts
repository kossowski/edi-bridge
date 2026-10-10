import { describe, expect, it } from 'vitest'

import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingVersionSummary } from '@edi-bridge/contracts'

import {
  byKind,
  changeCounts,
  comparisonHref,
  comparisonSearch,
  newestFirst,
  outputChange,
  repetitionsOf,
  resolveSample,
  resolveVersions,
  trailOf,
} from './version-comparison'

const mappingId = '7d0b1c2e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'

function version(number: number): MappingVersionSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${number}`,
    mappingId,
    mappingName: 'Hansemarkt: ORDERS to ERP JSON',
    version: number,
    publishedAt: `2026-0${number}-01T00:00:00.000Z`,
  }
}

const [v1, v2, v3] = [version(1), version(2), version(3)] as const

const listed = [v3, v2, v1]

describe('newestFirst', () => {
  it('orders versions by number, whatever order they come in, and leaves the input as it was', () => {
    const unordered = [v2, v3, v1]

    expect(newestFirst(unordered)).toEqual([v3, v2, v1])
    expect(unordered).toEqual([v2, v3, v1])
  })
})

describe('resolveVersions', () => {
  it('compares the latest version with the one before it by default', () => {
    expect(resolveVersions(listed, {})).toEqual({ kind: 'ready', from: v2, to: v3 })
    expect(resolveVersions([v1, v3, v2], {})).toEqual({ kind: 'ready', from: v2, to: v3 })
  })

  it('takes the chosen versions in any order', () => {
    expect(resolveVersions(listed, { from: v3.id, to: v1.id })).toEqual({
      kind: 'ready',
      from: v3,
      to: v1,
    })
  })

  it('needs at least two versions', () => {
    expect(resolveVersions([v1], {})).toEqual({ kind: 'tooFew' })
    expect(resolveVersions([], {})).toEqual({ kind: 'tooFew' })
  })

  it('tells a version that is not one of the Mapping', () => {
    expect(resolveVersions(listed, { from: 'unknown' })).toEqual({
      kind: 'unknownVersion',
      from: null,
      to: v3.id,
    })
  })

  it('tells a comparison of a version with itself', () => {
    expect(resolveVersions(listed, { from: v2.id, to: v2.id })).toEqual({
      kind: 'sameVersion',
      from: v2.id,
      to: v2.id,
    })
  })
})

describe('resolveSample', () => {
  const samples = [
    { id: 's1', name: 'po-1.edi', document: { format: 'edifact' as const, content: '' } },
    { id: 's2', name: 'po-2.edi', document: { format: 'edifact' as const, content: '' } },
  ]

  it('takes the first Sample Document by default', () => {
    expect(resolveSample(samples, undefined)).toEqual({ kind: 'ready', sample: samples[0] })
  })

  it('takes the chosen Sample Document', () => {
    expect(resolveSample(samples, 's2')).toEqual({ kind: 'ready', sample: samples[1] })
  })

  it('tells an unknown Sample Document and a Mapping without any', () => {
    expect(resolveSample(samples, 's9')).toEqual({ kind: 'unknown' })
    expect(resolveSample([], undefined)).toEqual({ kind: 'none' })
  })
})

describe('comparisonSearch', () => {
  it('sets the chosen versions and Sample Document and keeps other parameters', () => {
    expect(comparisonSearch('?id=story&from=old', { from: 'a', to: 'b', sample: 'c' })).toBe(
      '?id=story&from=a&to=b&sample=c',
    )
  })

  it('drops what is not chosen', () => {
    expect(comparisonSearch('from=a&sample=c', { from: 'a' })).toBe('?from=a')
    expect(comparisonSearch('', {})).toBe('')
  })
})

describe('comparisonHref', () => {
  it('links to the comparison of a Mapping', () => {
    expect(comparisonHref(mappingId)).toBe(`/mappings/${mappingId}/versions/compare`)
    expect(comparisonHref(mappingId, { from: 'a', to: 'b' })).toBe(
      `/mappings/${mappingId}/versions/compare?from=a&to=b`,
    )
  })
})

function item(path: string, overrides: Partial<TreeItem> = {}): TreeItem {
  return {
    path,
    kind: 'element',
    label: path.split('/').at(-1)!,
    name: null,
    detail: null,
    required: false,
    repeat: null,
    children: null,
    ...overrides,
  }
}

const tree = [
  item('SG28', {
    kind: 'segmentGroup',
    repeat: 200000,
    children: [
      item('SG28/LIN', {
        kind: 'segment',
        label: 'LIN',
        children: [item('SG28/LIN/7140', { label: '7140', name: 'Item identifier' })],
      }),
      item('SG28/QTY', { kind: 'segment', label: 'QTY+21', repeat: 10, children: [] }),
    ],
  }),
]

describe('trailOf', () => {
  it('lists the parts from the root down to the path', () => {
    expect(trailOf(tree, 'SG28/LIN/7140').map(({ label }) => label)).toEqual([
      'SG28',
      'LIN',
      '7140',
    ])
  })

  it('finds nothing for an unknown path', () => {
    expect(trailOf(tree, 'SG28/PRI')).toEqual([])
  })
})

describe('repetitionsOf', () => {
  it('names the repeating part of each index, counting from 1', () => {
    expect(repetitionsOf(trailOf(tree, 'SG28/LIN/7140'), [2])).toEqual([
      { label: 'SG28', number: 3 },
    ])
  })

  it('keeps the numbers without names when the counts disagree', () => {
    expect(repetitionsOf(trailOf(tree, 'SG28/LIN/7140'), [0, 1])).toEqual([
      { label: null, number: 1 },
      { label: null, number: 2 },
    ])
  })
})

const link = {
  kind: 'link' as const,
  change: 'added' as const,
  before: null,
  after: { sourcePath: 'BGM/C106/1004', targetPath: 'orderNumber' },
}

describe('changeCounts', () => {
  it('counts the differences per change', () => {
    expect(changeCounts([link, link, { change: 'removed' }])).toEqual({
      added: 2,
      removed: 1,
      changed: 0,
    })
  })
})

describe('byKind', () => {
  it('groups the differences by links, Transforms and Transform Links', () => {
    expect(byKind([link])).toEqual([
      { kind: 'link', differences: [link] },
      { kind: 'transform', differences: [] },
      { kind: 'transformLink', differences: [] },
    ])
  })
})

describe('outputChange', () => {
  it('tells an added, removed or changed value', () => {
    expect(outputChange(null, 'a')).toBe('added')
    expect(outputChange('a', null)).toBe('removed')
    expect(outputChange('a', 'b')).toBe('changed')
  })
})
