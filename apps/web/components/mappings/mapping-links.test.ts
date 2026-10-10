import { describe, expect, it } from 'vitest'

import { messageTypeStructures, seedDocumentStructureOf } from '@edi-bridge/mocks'

import { addLink, canLink, leafPaths, linksOfItem, removeLink } from './mapping-links'
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

describe('canLink', () => {
  it('links a source leaf to a target leaf only', () => {
    expect(
      canLink(
        leaves,
        { side: 'source', path: 'orderDate' },
        { side: 'target', path: 'DTM+137/C507/2380' },
      ),
    ).toBe(true)
    expect(
      canLink(leaves, { side: 'source', path: 'buyer' }, { side: 'target', path: 'BGM/1004' }),
    ).toBe(false)
    expect(
      canLink(leaves, { side: 'source', path: 'orderDate' }, { side: 'target', path: 'DTM+137' }),
    ).toBe(false)
    expect(
      canLink(
        leaves,
        { side: 'target', path: 'BGM/1004' },
        { side: 'source', path: 'orderNumber' },
      ),
    ).toBe(false)
  })
})

describe('addLink', () => {
  it('appends a link into a free target', () => {
    const added = addLink(
      links,
      leaves,
      { side: 'source', path: 'orderDate' },
      { side: 'target', path: 'DTM+137/C507/2380' },
    )

    expect(added).toEqual({
      ok: true,
      change: {
        kind: 'add',
        link: { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
        links: [...links, { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' }],
      },
    })
  })

  it('refuses a second link into a linked target and names the first one', () => {
    expect(
      addLink(
        links,
        leaves,
        { side: 'source', path: 'orderDate' },
        { side: 'target', path: 'BGM/1004' },
      ),
    ).toEqual({ ok: false, reason: 'alreadyLinked', existing: links[0] })
  })

  it('lets one source feed several targets', () => {
    expect(
      addLink(
        links,
        leaves,
        { side: 'source', path: 'orderNumber' },
        { side: 'target', path: 'SG1+CT/RFF+CT/C506/1154' },
      ).ok,
    ).toBe(true)
  })

  it('refuses parts that hold others', () => {
    expect(
      addLink(links, leaves, { side: 'source', path: 'buyer' }, { side: 'target', path: 'BGM' }),
    ).toEqual({ ok: false, reason: 'notLinkable' })
  })
})

describe('removeLink', () => {
  it('removes only the given link', () => {
    expect(removeLink(links, links[1]!)).toEqual({
      kind: 'remove',
      link: links[1],
      links: [links[0], links[2]],
    })
  })
})

describe('linksOfItem', () => {
  it('gives a leaf its own links', () => {
    expect(linksOfItem(links, 'source', findItem(source, 'orderNumber')!)).toEqual([links[0]])
  })

  it('gives a part the links of every leaf inside it', () => {
    expect(linksOfItem(links, 'source', findItem(source, 'lines[]')!)).toEqual([links[1], links[2]])
    expect(linksOfItem(links, 'target', findItem(target, 'SG25')!)).toEqual([links[1], links[2]])
  })
})
