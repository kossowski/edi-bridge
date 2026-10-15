import { describe, expect, it } from 'vitest'

import { mappingSideLeaves, oriented } from './mapping-paths'

import type { DocumentField } from './document-structure'

describe('oriented', () => {
  it('reads an inbound Mapping from the Message Type into the Document', () => {
    expect(oriented('ORDERS', { document: 'ERP orders', edifact: 'ORDERS' })).toEqual({
      direction: 'inbound',
      source: 'ORDERS',
      target: 'ERP orders',
    })
  })

  it('reads an outbound Mapping from the Document into the Message Type', () => {
    expect(oriented('INVOIC', { document: 'ERP invoices', edifact: 'INVOIC' })).toEqual({
      direction: 'outbound',
      source: 'ERP invoices',
      target: 'INVOIC',
    })
  })
})

describe('mappingSideLeaves', () => {
  const orderNumber: DocumentField = {
    kind: 'field',
    path: 'orderNumber',
    name: 'orderNumber',
    label: 'Order number',
    labelReason: null,
    labelUnsure: false,
    required: true,
    type: 'string',
  }

  const documentStructure = { children: [orderNumber] }

  it('offers the Document fields as the target of an inbound Mapping', () => {
    const leaves = mappingSideLeaves('ORDERS', documentStructure)

    expect(leaves.target).toEqual(new Set(['orderNumber']))
    expect(leaves.source.has('BGM/1004')).toBe(true)
  })

  it('offers the Document fields as the source of an outbound Mapping', () => {
    const leaves = mappingSideLeaves('INVOIC', documentStructure)

    expect(leaves.source).toEqual(new Set(['orderNumber']))
    expect(leaves.target.has('BGM/1004')).toBe(true)
  })
})
