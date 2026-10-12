import { describe, expect, it } from 'vitest'

import {
  createDocumentStructureBodySchema,
  type DocumentStructure,
  documentStructureProblemSchema,
  documentStructureSchema,
  documentStructureSummarySchema,
  examplePreview,
  inferredDocumentStructureSchema,
  updateDocumentStructureBodySchema,
} from './document-structure'

function named(label: string, unsure = false) {
  return { label, labelReason: `A known name for ${label.toLowerCase()}.`, unsure }
}

const purchaseOrder: DocumentStructure = {
  id: '00000006-0000-4000-8000-000000000001',
  name: 'ERP purchase order',
  format: 'json',
  root: 'object',
  example: {
    fileName: 'order-4711.json',
    text: '{ "orderNumber": "4711", "buyer": { "gln": "4012345000009" }, "lines": [] }',
    takenAt: '2026-09-15T10:00:00.000Z',
  },
  children: [
    {
      kind: 'field',
      path: 'orderNumber',
      name: 'orderNumber',
      ...named('Order number'),
      type: 'string',
      required: true,
    },
    {
      kind: 'object',
      path: 'buyer',
      name: 'buyer',
      ...named('Buyer'),
      required: true,
      children: [
        {
          kind: 'field',
          path: 'buyer.gln',
          name: 'gln',
          ...named('GLN', true),
          type: 'string',
          required: true,
        },
      ],
    },
    {
      kind: 'array',
      path: 'lines[]',
      name: 'lines',
      ...named('Lines'),
      required: true,
      items: {
        kind: 'object',
        path: 'lines[]',
        name: 'lines',
        ...named('Lines'),
        required: true,
        children: [
          {
            kind: 'field',
            path: 'lines[].quantity',
            name: 'quantity',
            ...named('Quantity'),
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
          ...named('Tags'),
          required: false,
          items: {
            kind: 'field',
            path: 'tags[]',
            name: 'tags',
            ...named('Tags'),
            type: 'string',
            required: true,
          },
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

  it('rejects a node without a plain name', () => {
    const unnamed = { ...purchaseOrder.children[0]!, label: undefined }

    expect(
      documentStructureSchema.safeParse({ ...purchaseOrder, children: [unnamed] }).success,
    ).toBe(false)
  })

  it('rejects a plain name of only spaces', () => {
    const blank = { ...purchaseOrder.children[0]!, label: '   ' }

    expect(documentStructureSchema.safeParse({ ...purchaseOrder, children: [blank] }).success).toBe(
      false,
    )
  })

  it('accepts a structure without an example file, as created from a JSON Schema', () => {
    expect(documentStructureSchema.safeParse({ ...purchaseOrder, example: null }).success).toBe(
      true,
    )
  })

  it('rejects an example file without the time it was taken', () => {
    const undated = { ...purchaseOrder, example: { ...purchaseOrder.example, takenAt: undefined } }

    expect(documentStructureSchema.safeParse(undated).success).toBe(false)
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

  it('rejects array items with another plain name than their array', () => {
    const lines = purchaseOrder.children[2]!

    const renamed = {
      ...purchaseOrder,
      children: [
        lines.kind === 'array'
          ? { ...lines, items: { ...lines.items, label: 'Order lines' } }
          : lines,
      ],
    }

    expect(documentStructureSchema.safeParse(renamed).success).toBe(false)
  })

  const rows = {
    kind: 'array',
    path: 'rows[]',
    name: 'rows',
    ...named('Rows'),
    required: true,
    items: {
      kind: 'object',
      path: 'rows[]',
      name: 'rows',
      ...named('Rows'),
      required: true,
      children: [
        {
          kind: 'field',
          path: 'rows[].Straße',
          name: 'Straße',
          ...named('Street'),
          type: 'string',
          required: false,
        },
      ],
    },
  }

  const csvStructure = {
    id: '00000006-0000-4000-8000-000000000009',
    name: 'ERP dispatch export',
    format: 'csv',
    csv: { delimiter: ';', headerRow: true, encoding: 'windows-1252' },
    example: {
      fileName: 'lieferscheine.csv',
      text: 'Straße\nKönigstraße 12\n',
      takenAt: '2026-09-18T10:00:00.000Z',
    },
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

  const listOfOrders = {
    ...purchaseOrder,
    root: 'array',
    children: [
      {
        ...rows,
        path: 'items[]',
        name: 'items',
        items: {
          ...rows.items,
          path: 'items[]',
          name: 'items',
          children: [
            {
              kind: 'field',
              path: 'items[].orderNumber',
              name: 'orderNumber',
              ...named('Order number'),
              type: 'string',
              required: true,
            },
          ],
        },
      },
    ],
  }

  it('accepts a JSON structure of a list as one items[] list', () => {
    expect(documentStructureSchema.safeParse(listOfOrders).success).toBe(true)
  })

  it('rejects a JSON structure of a list with more than its items[] list', () => {
    const more = {
      ...listOfOrders,
      children: [...listOfOrders.children, purchaseOrder.children[0]],
    }

    expect(documentStructureSchema.safeParse(more).success).toBe(false)
    expect(
      documentStructureSchema.safeParse({ ...listOfOrders, children: purchaseOrder.children })
        .success,
    ).toBe(false)
  })

  it('keeps a JSON object with one items list apart from a JSON list', () => {
    expect(documentStructureSchema.safeParse({ ...listOfOrders, root: 'object' }).success).toBe(
      true,
    )
  })

  it('checks an inferred structure the same way, without id and name', () => {
    const inferred = {
      ...csvStructure,
      id: undefined,
      name: undefined,
      facts: { columnCount: 1, rowCount: 1 },
    }

    expect(inferredDocumentStructureSchema.safeParse(inferred).success).toBe(true)
    expect(
      inferredDocumentStructureSchema.safeParse({ ...inferred, children: purchaseOrder.children })
        .success,
    ).toBe(false)
  })
})

describe('inferredDocumentStructureSchema', () => {
  const tree = { ...purchaseOrder, id: undefined, name: undefined }

  it('counts the fields of a JSON Document for the reading steps', () => {
    expect(
      inferredDocumentStructureSchema.safeParse({ ...tree, facts: { fieldCount: 2 } }).success,
    ).toBe(true)
  })

  it('rejects the facts of another format', () => {
    expect(
      inferredDocumentStructureSchema.safeParse({
        ...tree,
        facts: { columnCount: 2, rowCount: 3 },
      }).success,
    ).toBe(false)
  })
})

describe('documentStructureSummarySchema', () => {
  const summary = {
    id: '00000006-0000-4000-8000-000000000001',
    name: 'ERP invoice export',
    format: 'csv',
    fieldCount: 12,
    firstFieldLabels: ['Invoice number', 'Invoice date', 'Order number'],
    example: {
      fileName: 'Rechnungsexport_2026-10-08.csv',
      takenAt: '2026-09-16T10:00:00.000Z',
      preview: 'RechNr;RechDatum\nR-2026-1188;08.10.2026',
    },
    mappings: [],
  }

  it('shows the example file and the first plain names on the card', () => {
    expect(documentStructureSummarySchema.parse(summary)).toEqual(summary)
  })

  it('accepts a format without an example file', () => {
    expect(documentStructureSummarySchema.safeParse({ ...summary, example: null }).success).toBe(
      true,
    )
  })

  it('names at most three fields', () => {
    const many = { ...summary, firstFieldLabels: ['A', 'B', 'C', 'D'] }

    expect(documentStructureSummarySchema.safeParse(many).success).toBe(false)
  })
})

describe('examplePreview', () => {
  it('keeps the first seven lines of an example file', () => {
    const text = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].join('\r\n')

    expect(examplePreview(text)).toBe('1\n2\n3\n4\n5\n6\n7')
  })

  it('keeps a short example file whole', () => {
    expect(examplePreview('{ "a": 1 }\n')).toBe('{ "a": 1 }\n')
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

  it('takes confirmed and renamed plain names by path', () => {
    const body = {
      name: 'ERP dispatch export',
      origin: { kind: 'jsonDocument', document },
      labels: [
        { path: 'rows[].Menge', label: 'Quantity' },
        { path: 'rows[].ME', label: 'Unit of measure' },
      ],
    }

    expect(createDocumentStructureBodySchema.safeParse(body).success).toBe(true)
  })

  it('rejects two plain names for the same path', () => {
    const body = {
      name: 'ERP dispatch export',
      origin: { kind: 'jsonDocument', document },
      labels: [
        { path: 'rows[].ME', label: 'Unit' },
        { path: 'rows[].ME', label: 'Unit of measure' },
      ],
    }

    expect(createDocumentStructureBodySchema.safeParse(body).success).toBe(false)
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

  it('takes new CSV settings with a CSV Document to read again', () => {
    const body = {
      name: 'ERP dispatch export',
      csv: { delimiter: ',', headerRow: false, encoding: 'utf-8' },
      document: { fileName: 'dispatch.csv', content: btoa('1,2\n') },
      adjustments: [],
    }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(true)
  })

  it('takes a rename of a field', () => {
    const body = {
      name: 'ERP purchase order',
      adjustments: [{ path: 'lines[].quantity', label: 'Ordered quantity' }],
    }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(true)
  })

  it('rejects a rename to an empty name', () => {
    const body = { name: 'ERP purchase order', adjustments: [{ path: 'buyer', label: ' ' }] }

    expect(updateDocumentStructureBodySchema.safeParse(body).success).toBe(false)
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
      mappingVersions: null,
    }

    expect(documentStructureProblemSchema.parse(problem)).toEqual(problem)
  })

  it('rejects a code it does not know', () => {
    const problem = {
      code: 'tooLarge',
      message: 'Too large',
      path: null,
      line: null,
      mappingVersions: null,
    }

    expect(documentStructureProblemSchema.safeParse(problem).success).toBe(false)
  })

  const version = {
    id: '00000007-0000-4000-8000-000000000001',
    mappingId: '00000005-0000-4000-8000-000000000001',
    mappingName: 'Hansemarkt ORDERS',
    version: 3,
    publishedAt: '2026-10-01T08:00:00.000Z',
  }

  it('names the Mapping Versions that use a node', () => {
    const problem = {
      code: 'usedByMappingVersion',
      message: 'Published Mapping Versions use buyer.gln: Hansemarkt ORDERS v3',
      path: 'buyer.gln',
      line: null,
      mappingVersions: [version],
    }

    expect(documentStructureProblemSchema.parse(problem)).toEqual(problem)
    expect(
      documentStructureProblemSchema.safeParse({ ...problem, mappingVersions: null }).success,
    ).toBe(false)
  })

  it('names Mapping Versions only for usedByMappingVersion', () => {
    const problem = {
      code: 'linkedByMapping',
      message: 'A Mapping Draft links lines[].gtin',
      path: 'lines[]',
      line: null,
      mappingVersions: [version],
    }

    expect(documentStructureProblemSchema.safeParse(problem).success).toBe(false)
  })
})
