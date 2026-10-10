import { describe, expect, it } from 'vitest'

import { messageTypeStructures, seedDocumentStructureOf } from '@edi-bridge/mocks'

import {
  expressionPathItems,
  isLinkableRow,
  isWholePart,
  leafPaths,
  linksOfItem,
  pathsBeneath,
  repeatingPaths,
  rowListingLinks,
} from './mapping-links'
import { documentTree, edifactTree, findItem } from './mapping-tree'

const source = documentTree(seedDocumentStructureOf.ORDERS)

const target = edifactTree(messageTypeStructures.ORDERS, 'en')

const leaves = { source: leafPaths(source), target: leafPaths(target) }

const links = [
  { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
  { sourcePath: 'lines[].gtin', targetPath: 'SG25/LIN/C212/7140' },
  { sourcePath: 'lines[].quantity', targetPath: 'SG25/QTY+21/C186/6060' },
]

describe('leafPaths', () => {
  it('keeps fields and elements and leaves out the parts holding them', () => {
    expect(leaves.source).toContain('lines[].gtin')
    expect(leaves.source).not.toContain('lines[]')
    expect(leaves.target).toContain('DTM+137/C507/2380')
    expect(leaves.target).not.toContain('DTM+137/C507')
  })
})

describe('linkable rows', () => {
  const rows = {
    leaves: leaves,
    parts: { source: repeatingPaths(source), target: repeatingPaths(target) },
  }

  it('links fields and whole repeating parts, but no other parts', () => {
    expect(isLinkableRow(rows, { side: 'source', path: 'lines[].gtin' })).toBe(true)
    expect(isLinkableRow(rows, { side: 'target', path: 'SG25' })).toBe(true)
    expect(isLinkableRow(rows, { side: 'target', path: 'DTM+137/C507' })).toBe(false)
  })

  it('tells a whole repeating part from a field', () => {
    expect(isWholePart(rows, { side: 'source', path: 'lines[]' })).toBe(true)
    expect(isWholePart(rows, { side: 'source', path: 'lines[].gtin' })).toBe(false)
  })
})

describe('pathsBeneath', () => {
  it('gives the fields inside a part', () => {
    expect(pathsBeneath(source, 'lines[]')).toContain('lines[].gtin')
    expect(pathsBeneath(source, 'lines[]')).not.toContain('orderNumber')
    expect(pathsBeneath(source, 'unknown').size).toBe(0)
  })
})

describe('expressionPathItems', () => {
  it('lists fields and repeating parts in tree order, each part before its fields', () => {
    const paths = expressionPathItems(source).map(({ path }) => path)

    expect(paths).toContain('orderNumber')
    expect(paths.indexOf('lines[]')).toBeGreaterThanOrEqual(0)
    expect(paths.indexOf('lines[]')).toBeLessThan(paths.indexOf('lines[].gtin'))
  })
})

describe('linksOfItem', () => {
  const graph = { links, transforms: [], transformLinks: [] }
  const plain = (index: number) => ({ kind: 'link', link: links[index] })

  it('gives a leaf its own links', () => {
    expect(linksOfItem(graph, 'source', findItem(source, 'orderNumber')!)).toEqual([plain(0)])
  })

  it('gives a part the links of every leaf inside it', () => {
    expect(linksOfItem(graph, 'source', findItem(source, 'lines[]')!)).toEqual([plain(1), plain(2)])
    expect(linksOfItem(graph, 'target', findItem(target, 'SG25')!)).toEqual([plain(1), plain(2)])
  })

  it('counts links to and from transforms, and loops that take a whole part', () => {
    const transformId = '00000000-0000-4000-8000-000000000001'

    const intoTransform = {
      from: { kind: 'source', path: 'orderDate' },
      to: { kind: 'transform', transformId, input: 'value' },
    } as const

    const fromTransform = {
      from: { kind: 'transform', transformId, output: 'value' },
      to: { kind: 'target', path: 'DTM+137/C507/2380' },
    } as const

    const loopItems = {
      from: { kind: 'transform', transformId, output: 'items' },
      to: { kind: 'target', path: 'SG25' },
    } as const

    const withTransforms = { ...graph, transformLinks: [intoTransform, fromTransform, loopItems] }

    expect(linksOfItem(withTransforms, 'source', findItem(source, 'orderDate')!)).toEqual([
      { kind: 'transformLink', link: intoTransform },
    ])
    expect(linksOfItem(withTransforms, 'target', findItem(target, 'DTM+137')!)).toEqual([
      { kind: 'transformLink', link: fromTransform },
    ])
    expect(linksOfItem(withTransforms, 'target', findItem(target, 'SG25')!)).toEqual([
      plain(1),
      plain(2),
      { kind: 'transformLink', link: loopItems },
    ])
  })
})

describe('rowListingLinks', () => {
  it('lists links merged from several sources at the source part', () => {
    expect(
      rowListingLinks({
        sourcePath: 'lines[]',
        targetPath: 'SG25',
        links: [links[1]!, links[2]!],
      }),
    ).toEqual({ side: 'source', path: 'lines[]' })
  })

  it('lists links from one source at the target part', () => {
    expect(
      rowListingLinks({
        sourcePath: 'orderNumber',
        targetPath: 'BGM',
        links: [links[0]!],
      }),
    ).toEqual({ side: 'target', path: 'BGM' })
  })
})
