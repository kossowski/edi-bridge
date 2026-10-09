import { describe, expect, it } from 'vitest'

import { type DocumentStructure, documentStructureSchema } from './document-structure'

const purchaseOrder: DocumentStructure = {
  id: '00000006-0000-4000-8000-000000000001',
  name: 'ERP purchase order',
  format: 'json',
  children: [
    { kind: 'field', path: 'orderNumber', name: 'orderNumber', type: 'string', required: true },
    {
      kind: 'object',
      path: 'buyer',
      name: 'buyer',
      required: true,
      children: [{ kind: 'field', path: 'buyer.gln', name: 'gln', type: 'string', required: true }],
    },
    {
      kind: 'array',
      path: 'lines[]',
      name: 'lines',
      required: true,
      items: {
        kind: 'object',
        path: 'lines[]',
        name: 'lines',
        required: true,
        children: [
          {
            kind: 'field',
            path: 'lines[].quantity',
            name: 'quantity',
            type: 'number',
            required: true,
          },
        ],
      },
    },
  ],
}

describe('documentStructureSchema', () => {
  it('accepts nested objects and repeating arrays', () => {
    expect(documentStructureSchema.parse(purchaseOrder)).toEqual(purchaseOrder)
  })

  it('accepts a repeating list of plain values', () => {
    const withTags = {
      ...purchaseOrder,
      children: [
        {
          kind: 'array',
          path: 'tags[]',
          name: 'tags',
          required: false,
          items: { kind: 'field', path: 'tags[]', name: 'tags', type: 'string', required: true },
        },
      ],
    }

    expect(documentStructureSchema.safeParse(withTags).success).toBe(true)
  })

  it('rejects a field type it does not know', () => {
    const withUnknownType = {
      ...purchaseOrder,
      children: [{ ...purchaseOrder.children[0]!, type: 'money' }],
    }

    expect(documentStructureSchema.safeParse(withUnknownType).success).toBe(false)
  })

  it('rejects an empty structure', () => {
    expect(documentStructureSchema.safeParse({ ...purchaseOrder, children: [] }).success).toBe(
      false,
    )
  })
})
