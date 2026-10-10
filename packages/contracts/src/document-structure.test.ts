import { describe, expect, it } from 'vitest'

import {
  createDocumentStructureBodySchema,
  type DocumentStructure,
  documentStructureProblemSchema,
  documentStructureSchema,
  inferredDocumentStructureSchema,
  updateDocumentStructureBodySchema,
} from './document-structure'

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

describe('documentStructureSchema refinements', () => {
  it('rejects two nodes on the same path', () => {
    const twice = {
      ...purchaseOrder,
      children: [purchaseOrder.children[0]!, purchaseOrder.children[0]!],
    }

    expect(documentStructureSchema.safeParse(twice).success).toBe(false)
  })

  it('rejects array items on another path than their array', () => {
    const lines = purchaseOrder.children[2]!

    const moved = {
      ...purchaseOrder,
      children: [
        lines.kind === 'array' ? { ...lines, items: { ...lines.items, path: 'lines' } } : lines,
      ],
    }

    expect(documentStructureSchema.safeParse(moved).success).toBe(false)
  })

  const rows = {
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
        { kind: 'field', path: 'rows[].Straße', name: 'Straße', type: 'string', required: false },
      ],
    },
  }

  const csvStructure = {
    id: '00000006-0000-4000-8000-000000000009',
    name: 'ERP dispatch export',
    format: 'csv',
    csv: { delimiter: ';', headerRow: true, encoding: 'windows-1252' },
    children: [rows],
  }

  it('accepts a CSV structure of one repeating row of columns', () => {
    expect(documentStructureSchema.safeParse(csvStructure).success).toBe(true)
  })

  it('requires CSV settings on a CSV structure', () => {
    const withoutSettings = { ...csvStructure, csv: undefined }

    expect(documentStructureSchema.safeParse(withoutSettings).success).toBe(false)
  })

  it('rejects a CSV structure with nesting', () => {
    const nested = { ...csvStructure, children: purchaseOrder.children }

    expect(documentStructureSchema.safeParse(nested).success).toBe(false)
  })

  it('rejects an encoding it does not know', () => {
    const latin9 = { ...csvStructure, csv: { ...csvStructure.csv, encoding: 'iso-8859-15' } }

    expect(documentStructureSchema.safeParse(latin9).success).toBe(false)
  })

  it('checks an inferred structure the same way, without id and name', () => {
    const inferred = { ...csvStructure, id: undefined, name: undefined }

    expect(inferredDocumentStructureSchema.safeParse(inferred).success).toBe(true)
    expect(
      inferredDocumentStructureSchema.safeParse({ ...inferred, children: purchaseOrder.children })
        .success,
    ).toBe(false)
  })
})

describe('createDocumentStructureBodySchema', () => {
  const document = { fileName: 'orders.csv', content: btoa('Straße;Menge\n') }

  it('takes a CSV Document with its CSV settings', () => {
    const body = {
      name: 'ERP dispatch export',
      origin: {
        kind: 'csvDocument',
        document,
        csv: { delimiter: ';', headerRow: true, encoding: 'utf-8' },
      },
    }

    expect(createDocumentStructureBodySchema.safeParse(body).success).toBe(true)
  })

  it('rejects a CSV Document without CSV settings', () => {
    const body = { name: 'ERP dispatch export', origin: { kind: 'csvDocument', document } }

    expect(createDocumentStructureBodySchema.safeParse(body).success).toBe(false)
  })

  it('rejects content that is not base64', () => {
    const body = {
      name: 'ERP order',
      origin: { kind: 'jsonDocument', document: { fileName: 'order.json', content: '{"a":1}' } },
    }

    expect(createDocumentStructureBodySchema.safeParse(body).success).toBe(false)
  })
})

describe('updateDocumentStructureBodySchema', () => {
  it('takes per-node adjustments', () => {
    const body = {
      name: 'ERP purchase order',
      adjustments: [
        { path: 'buyer', repeating: true },
        { path: 'buyer.gln', required: false, type: 'string' },
      ],
    }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(true)
  })

  it('rejects an adjustment that changes nothing', () => {
    const body = { name: 'ERP purchase order', adjustments: [{ path: 'buyer' }] }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(false)
  })

  it('rejects two adjustments of the same node', () => {
    const body = {
      name: 'ERP purchase order',
      adjustments: [
        { path: 'buyer', required: false },
        { path: 'buyer', repeating: true },
      ],
    }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(false)
  })
})

describe('documentStructureProblemSchema', () => {
  it('locates a problem in a CSV Document by line', () => {
    const problem = {
      code: 'inconsistentCsvRows',
      message: 'Line 3 has more cells than the header row',
      path: null,
      line: 3,
    }

    expect(documentStructureProblemSchema.parse(problem)).toEqual(problem)
  })

  it('rejects a code it does not know', () => {
    const problem = { code: 'tooLarge', message: 'Too large', path: null, line: null }

    expect(documentStructureProblemSchema.safeParse(problem).success).toBe(false)
  })
})
