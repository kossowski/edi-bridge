import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type DocumentField,
  type DocumentFieldType,
  documentFieldTypes,
  type DocumentStructure,
  documentStructureEndpoint,
  type DocumentStructureNode,
  documentStructureSchema,
} from '@edi-bridge/contracts'

import { notFound } from './responses'
import { seedId } from './seed-id'

type FieldSpec = readonly [name: string, type: DocumentFieldType, required?: boolean]

type Spec =
  | FieldSpec
  | { object: string; required?: boolean; fields: ReadonlyArray<Spec> }
  | { array: string; required?: boolean; fields: ReadonlyArray<Spec> }

function isField(spec: Spec): spec is FieldSpec {
  return Array.isArray(spec)
}

function childPath(parentPath: string, name: string) {
  return parentPath === '' ? name : `${parentPath}.${name}`
}

function toNodes(specs: ReadonlyArray<Spec>, parentPath: string): DocumentStructureNode[] {
  return specs.map((spec) => {
    if (isField(spec)) {
      const [name, type, required = true] = spec

      return { kind: 'field', path: childPath(parentPath, name), name, type, required }
    }

    if ('object' in spec) {
      const path = childPath(parentPath, spec.object)

      return {
        kind: 'object',
        path,
        name: spec.object,
        required: spec.required ?? true,
        children: toNodes(spec.fields, path),
      }
    }

    const path = `${childPath(parentPath, spec.array)}[]`

    return {
      kind: 'array',
      path,
      name: spec.array,
      required: spec.required ?? true,
      items: {
        kind: 'object',
        path,
        name: spec.array,
        required: true,
        children: toNodes(spec.fields, path),
      },
    }
  })
}

function structure(index: number, name: string, specs: ReadonlyArray<Spec>): DocumentStructure {
  return documentStructureSchema.parse({
    id: seedId(6, index),
    name,
    format: 'json',
    children: toNodes(specs, ''),
  })
}

const address: ReadonlyArray<Spec> = [
  ['gln', 'string'],
  ['name', 'string', false],
  ['street', 'string', false],
  ['postalCode', 'string', false],
  ['city', 'string', false],
  ['country', 'string', false],
]

const party = (name: string, required = true, extra: ReadonlyArray<Spec> = []): Spec => ({
  object: name,
  required,
  fields: [...address, ...extra],
})

const vatId: FieldSpec = ['vatId', 'string', false]

export const seedDocumentStructures: ReadonlyArray<DocumentStructure> = [
  structure(1, 'ERP purchase order', [
    ['orderNumber', 'string'],
    ['orderDate', 'date'],
    ['requestedDeliveryDate', 'date', false],
    ['contractNumber', 'string', false],
    ['currency', 'string', false],
    ['note', 'string', false],
    party('buyer', true, [
      vatId,
      {
        object: 'contact',
        required: false,
        fields: [
          ['name', 'string'],
          ['phone', 'string', false],
          ['email', 'string', false],
        ],
      },
    ]),
    party('supplier', true, [vatId]),
    party('deliveryParty', false),
    party('invoicee', false),
    {
      array: 'lines',
      fields: [
        ['lineNumber', 'integer'],
        ['gtin', 'string'],
        ['supplierArticleNumber', 'string', false],
        ['buyerArticleNumber', 'string', false],
        ['description', 'string', false],
        ['quantity', 'number'],
        ['unit', 'string', false],
        ['netPrice', 'number', false],
        ['requestedDeliveryDate', 'date', false],
      ],
    },
    ['lineCount', 'integer', false],
  ]),
  structure(2, 'ERP dispatch advice', [
    ['despatchNumber', 'string'],
    ['despatchDate', 'date'],
    ['documentDate', 'date'],
    ['estimatedDeliveryDate', 'date', false],
    ['orderNumber', 'string'],
    party('buyer'),
    party('supplier'),
    party('shipTo'),
    {
      array: 'packages',
      fields: [
        ['packageNumber', 'integer'],
        ['parentPackageNumber', 'integer', false],
        ['packageType', 'string'],
        ['sscc', 'string'],
        {
          array: 'lines',
          fields: [
            ['lineNumber', 'integer'],
            ['gtin', 'string'],
            ['supplierArticleNumber', 'string', false],
            ['description', 'string', false],
            ['quantity', 'number'],
          ],
        },
      ],
    },
  ]),
  structure(3, 'ERP invoice', [
    ['invoiceNumber', 'string'],
    ['invoiceDate', 'date'],
    ['isCreditNote', 'boolean'],
    ['deliveryDate', 'date', false],
    ['orderNumber', 'string', false],
    ['deliveryNoteNumber', 'string', false],
    ['currency', 'string'],
    ['paymentDueDate', 'date', false],
    party('buyer', true, [vatId]),
    party('supplier', true, [vatId]),
    party('invoicee', false),
    party('shipTo', false),
    {
      array: 'lines',
      fields: [
        ['lineNumber', 'integer'],
        ['gtin', 'string'],
        ['supplierArticleNumber', 'string', false],
        ['description', 'string', false],
        ['quantity', 'number'],
        ['netPrice', 'number'],
        ['lineAmount', 'number'],
        ['vatRate', 'number'],
      ],
    },
    {
      object: 'totals',
      fields: [
        ['lineTotal', 'number'],
        ['taxableAmount', 'number'],
        ['vatAmount', 'number'],
        ['invoiceTotal', 'number'],
      ],
    },
    {
      array: 'vatBreakdown',
      fields: [
        ['rate', 'number'],
        ['amount', 'number'],
      ],
    },
  ]),
  structure(4, 'ERP acknowledgement status', [
    ['interchangeReference', 'string'],
    ['senderGln', 'string'],
    ['recipientGln', 'string'],
    ['status', 'string'],
    ['syntaxError', 'string', false],
    {
      array: 'messages',
      required: false,
      fields: [
        ['messageReference', 'string'],
        ['messageType', 'string'],
        ['status', 'string'],
        ['syntaxError', 'string', false],
        {
          array: 'segmentErrors',
          required: false,
          fields: [
            ['position', 'integer'],
            ['syntaxError', 'string', false],
          ],
        },
      ],
    },
  ]),
]

export function documentStructureLeaves(
  documentStructure: Pick<DocumentStructure, 'children'>,
): DocumentField[] {
  const visit = (node: DocumentStructureNode): DocumentField[] => {
    switch (node.kind) {
      case 'field':
        return [node]
      case 'object':
        return node.children.flatMap(visit)
      case 'array':
        return visit(node.items)
    }
  }

  return documentStructure.children.flatMap(visit)
}

// Spreads the fields over plain fields, objects and arrays of objects with a nested array, so a
// large structure still shows every kind of nesting.
export function createDocumentStructure({
  fieldCount,
  seed = 23,
  name = 'ERP master data export',
}: {
  fieldCount: number
  seed?: number
  name?: string
}): DocumentStructure {
  const faker = new Faker({ locale: [en], seed })
  const used = new Set<string>()

  const uniqueName = () => {
    const base =
      faker.word
        .noun()
        .replaceAll(/[^A-Za-z]/g, '')
        .toLowerCase() || 'field'

    let candidate = base

    for (let suffix = 2; used.has(candidate); suffix++) {
      candidate = `${base}${suffix}`
    }

    used.add(candidate)

    return candidate
  }

  let remaining = fieldCount

  const takeFields = (count: number): FieldSpec[] => {
    const taken = Math.min(count, remaining)
    remaining -= taken

    return Array.from({ length: taken }, () => [
      uniqueName(),
      faker.helpers.arrayElement(documentFieldTypes),
      faker.datatype.boolean({ probability: 0.6 }),
    ])
  }

  const specs: Spec[] = []

  for (let section = 0; remaining > 0; section++) {
    switch (section % 3) {
      case 0:
        specs.push(...takeFields(faker.number.int({ min: 2, max: 5 })))
        break
      case 1:
        specs.push({
          object: uniqueName(),
          fields: takeFields(faker.number.int({ min: 3, max: 8 })),
        })
        break
      default: {
        const fields: Spec[] = takeFields(faker.number.int({ min: 3, max: 8 }))
        const nested = takeFields(faker.number.int({ min: 2, max: 4 }))

        if (nested.length > 0) {
          fields.push({ array: uniqueName(), required: false, fields: nested })
        }

        specs.push({ array: uniqueName(), fields })
      }
    }
  }

  return documentStructureSchema.parse({
    id: faker.string.uuid(),
    name,
    format: 'json',
    children: toNodes(
      specs.filter((spec) => isField(spec) || spec.fields.length > 0),
      '',
    ),
  })
}

export function documentStructureHandler(
  apiUrl: string,
  documentStructures: ReadonlyArray<DocumentStructure> = seedDocumentStructures,
) {
  return http.get<{ id: string }>(`${apiUrl}${documentStructureEndpoint.path}`, ({ params }) => {
    const found = documentStructures.find(({ id }) => id === params.id)

    return found ? HttpResponse.json(found) : notFound()
  })
}
