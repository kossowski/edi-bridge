import { describe, expect, it } from 'vitest'

import { defaultCsvSettings, type DocumentStructureNode } from '@edi-bridge/contracts'
import { createDocumentStructure, seedDocumentStructureOf } from '@edi-bridge/mocks'

import {
  adjustable,
  adjustedSettings,
  ancestorPaths,
  encodeBase64,
  fileProblem,
  initialExpanded,
  leafCount,
  nameFromFileName,
  originKindOf,
  toOrigin,
  visibleRows,
  withAdjustment,
} from './structure-tree'

const order = seedDocumentStructureOf.ORDERS

function nodeAt(path: string) {
  const found = visibleRows(order.children, new Set(['buyer', 'lines[]'])).find(
    ({ node }) => node.path === path,
  )

  if (!found) {
    throw new Error(`No node at ${path}`)
  }

  return found.node
}

const csvTree = {
  format: 'csv' as const,
  children: [
    {
      kind: 'array',
      path: 'rows[]',
      name: 'rows',
      required: true,
      items: {
        kind: 'object',
        path: 'rows[]',
        name: 'rows',
        required: true,
        children: [
          { kind: 'field', path: 'rows[].gtin', name: 'gtin', required: true, type: 'string' },
        ],
      },
    },
  ] satisfies DocumentStructureNode[],
}

describe('withAdjustment', () => {
  it('records only what differs from the stored node', () => {
    const note = nodeAt('note')

    const adjusted = withAdjustment(new Map(), note, { required: true, repeating: false })

    expect([...adjusted.values()]).toEqual([{ path: 'note', required: true }])
    expect(adjustedSettings(note, adjusted)).toEqual({
      required: true,
      repeating: false,
      type: 'string',
    })
  })

  it('drops an adjustment once every change is undone', () => {
    const buyer = nodeAt('buyer')
    const repeating = withAdjustment(new Map(), buyer, { repeating: true })

    expect(withAdjustment(repeating, buyer, { repeating: false }).size).toBe(0)
  })

  it('keeps earlier changes of the same node', () => {
    const quantity = nodeAt('lines[].quantity')

    const adjusted = withAdjustment(
      withAdjustment(new Map(), quantity, { type: 'integer' }),
      quantity,
      { required: false },
    )

    expect(adjusted.get('lines[].quantity')).toEqual({
      path: 'lines[].quantity',
      required: false,
      type: 'integer',
    })
  })
})

describe('adjustable', () => {
  it('lets a JSON field change every setting', () => {
    expect(adjustable(order, nodeAt('note'))).toEqual({
      required: true,
      repeating: true,
      type: true,
    })
  })

  it('gives an object no type', () => {
    expect(adjustable(order, nodeAt('buyer')).type).toBe(false)
  })

  it('never lets a CSV column repeat and keeps the rows fixed', () => {
    const [rows] = csvTree.children
    const column = rows!.items.children[0]!

    expect(adjustable(csvTree, column)).toEqual({ required: true, repeating: false, type: true })
    expect(adjustable(csvTree, rows!)).toEqual({ required: false, repeating: false, type: false })
  })
})

describe('visibleRows', () => {
  it('shows the children of expanded containers only, with their level and position', () => {
    const rows = visibleRows(order.children, new Set(['lines[]']))
    const gtin = rows.find(({ node }) => node.path === 'lines[].gtin')

    expect(rows.some(({ node }) => node.path === 'buyer.gln')).toBe(false)
    expect(gtin).toMatchObject({ level: 2, position: 2, parentPath: 'lines[]', expanded: null })
    expect(rows.find(({ node }) => node.path === 'buyer')).toMatchObject({
      expanded: false,
      childCount: 8,
    })
  })
})

describe('initialExpanded', () => {
  it('opens a small Document Structure completely', () => {
    expect(initialExpanded(order.children)).toEqual(
      new Set(['buyer', 'buyer.contact', 'supplier', 'deliveryParty', 'invoicee', 'lines[]']),
    )
  })

  it('keeps a large Document Structure within the row limit', () => {
    const large = createDocumentStructure({ fieldCount: 2000 })

    expect(
      visibleRows(large.children, initialExpanded(large.children, 120)).length,
    ).toBeLessThanOrEqual(Math.max(120, large.children.length))
  })
})

describe('ancestorPaths', () => {
  it('names the containers to open to show a node', () => {
    expect(ancestorPaths(order.children, 'buyer.contact.phone')).toEqual(['buyer', 'buyer.contact'])
    expect(ancestorPaths(order.children, 'missing')).toBeNull()
  })
})

describe('leafCount', () => {
  it('counts the fields', () => {
    expect(leafCount(csvTree.children)).toBe(1)
  })
})

describe('file helpers', () => {
  it('encodes bytes as base64', () => {
    expect(encodeBase64(new TextEncoder().encode('Kühlware'))).toBe(
      Buffer.from('Kühlware').toString('base64'),
    )
  })

  it('refuses empty and too large files', () => {
    expect(fileProblem(0)).toBe('empty')
    expect(fileProblem(5_000_001)).toBe('tooLarge')
    expect(fileProblem(12)).toBeNull()
  })

  it('guesses the origin from the file name', () => {
    expect(originKindOf('article.schema.json')).toBe('jsonSchema')
    expect(originKindOf('Order.JSON')).toBe('jsonDocument')
    expect(originKindOf('lieferscheine.csv')).toBe('csvDocument')
    expect(originKindOf('notes.pdf')).toBeNull()
  })

  it('reads a CSV Document with the default CSV settings', () => {
    const file = { fileName: 'a.csv', content: 'YQ==' }

    expect(toOrigin('csvDocument', file)).toEqual({
      kind: 'csvDocument',
      document: file,
      csv: defaultCsvSettings,
    })
    expect(toOrigin('jsonSchema', file)).toEqual({ kind: 'jsonSchema', jsonSchema: file })
  })

  it('suggests a name from the file name', () => {
    expect(nameFromFileName('article.schema.json')).toBe('article')
    expect(nameFromFileName('erp_dispatch-export.csv')).toBe('erp dispatch export')
  })
})
