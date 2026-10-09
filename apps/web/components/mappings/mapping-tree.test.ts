import { describe, expect, it } from 'vitest'

import { messageTypeStructures, seedDocumentStructureOf } from '@edi-bridge/mocks'

import { canvasLinks, documentTree, edifactTree, layoutTree, type TreeItem } from './mapping-tree'

function find(items: ReadonlyArray<TreeItem>, path: string): TreeItem | undefined {
  for (const item of items) {
    if (item.path === path) {
      return item
    }

    const found = find(item.children ?? [], path)

    if (found) {
      return found
    }
  }

  return undefined
}

describe('documentTree', () => {
  const tree = documentTree(seedDocumentStructureOf.ORDERS)

  it('shows an array and its item as one repeating part', () => {
    const lines = find(tree, 'lines[]')

    expect(lines).toMatchObject({ kind: 'array', label: 'lines', repeat: 'unbounded' })
    expect(lines?.children?.map(({ path }) => path)).toContain('lines[].gtin')
  })

  it('nests objects', () => {
    expect(find(tree, 'buyer.contact')).toMatchObject({ kind: 'object', repeat: null })
    expect(find(tree, 'buyer.contact.name')).toMatchObject({ kind: 'field', detail: 'string' })
  })
})

describe('edifactTree', () => {
  const tree = edifactTree(messageTypeStructures.ORDERS, 'de')

  it('labels qualified segments with their qualifier and names them in the locale', () => {
    const segment = find(tree, 'DTM+137')

    expect(segment).toMatchObject({ kind: 'segment', label: 'DTM+137' })
    expect(segment?.name).not.toBe(
      find(edifactTree(messageTypeStructures.ORDERS, 'en'), 'DTM+137')?.name,
    )
  })

  it('marks segment groups that repeat with their maximum', () => {
    expect(find(tree, 'SG25')).toMatchObject({ kind: 'segmentGroup', label: 'SG25' })
    expect(find(tree, 'SG25')?.repeat).toBeGreaterThan(1)
  })

  it('labels elements with their code and format', () => {
    expect(find(tree, 'DTM+137/C507/2380')).toMatchObject({ label: '2380', kind: 'element' })
  })
})

describe('layoutTree', () => {
  const tree = documentTree(seedDocumentStructureOf.ORDERS)

  it('places every part below the previous one, children inside their parent', () => {
    const { rows } = layoutTree(tree, { side: 'source', x: 0, y: 0, collapsed: new Set() })
    const buyer = rows.find(({ path }) => path === 'buyer')!
    const gln = rows.find(({ path }) => path === 'buyer.gln')!

    expect(gln.y).toBeGreaterThan(buyer.y)
    expect(gln.y + gln.height).toBeLessThanOrEqual(buyer.y + buyer.height)
    expect(gln.x).toBeGreaterThan(buyer.x)
    expect(gln.x + gln.width).toBeLessThanOrEqual(buyer.x + buyer.width)
  })

  it('hides the children of a collapsed part and shows them as the part', () => {
    const { rows, visible } = layoutTree(tree, {
      side: 'source',
      x: 0,
      y: 0,
      collapsed: new Set(['buyer']),
    })

    expect(rows.find(({ path }) => path === 'buyer.gln')).toBeUndefined()
    expect(rows.find(({ path }) => path === 'buyer')?.expanded).toBe(false)
    expect(visible.get('buyer.contact.name')).toBe('buyer')
  })

  it('keeps an empty container a container that cannot be linked or expanded', () => {
    const { rows } = layoutTree(
      documentTree({
        children: [
          { kind: 'object', path: 'header', name: 'header', required: false, children: [] },
        ],
      }),
      { side: 'source', x: 0, y: 0, collapsed: new Set() },
    )

    expect(rows).toMatchObject([{ path: 'header', linkable: false, expanded: null, childCount: 0 }])
  })
})

describe('canvasLinks', () => {
  it('merges links that end in the same collapsed part', () => {
    const source = new Map([
      ['buyer.gln', 'buyer'],
      ['buyer.name', 'buyer'],
    ])

    const target = new Map([
      ['SG2+BY/NAD+BY/C082/3039', 'SG2+BY'],
      ['SG2+BY/NAD+BY/C080/3036', 'SG2+BY'],
    ])

    const links = canvasLinks(
      [
        { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
        { sourcePath: 'buyer.name', targetPath: 'SG2+BY/NAD+BY/C080/3036' },
        { sourcePath: 'unknown', targetPath: 'SG2+BY/NAD+BY/C080/3036' },
      ],
      { source, target },
    )

    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ sourcePath: 'buyer', targetPath: 'SG2+BY' })
    expect(links[0]?.links).toHaveLength(2)
  })
})
