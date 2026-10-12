import { describe, expect, it } from 'vitest'

import {
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructure,
  type DocumentStructureNode,
  type DocumentStructureProblem,
  documentStructureSchema,
} from '@edi-bridge/contracts'

import { seedDocumentStructureOf } from './document-structure'
import {
  adjustDocumentStructure,
  decodeText,
  DocumentStructureProblemError,
  findNode,
  inferDocumentStructure,
  inferFromCsv,
  inferFromJson,
  inferFromJsonSchema,
  parseCsv,
} from './document-structure-inference'
import {
  createCsvDocument,
  documentStructureOrigins,
  toEncodedFile,
} from './document-structure-origin'

function problemOf(run: () => void): DocumentStructureProblem {
  try {
    run()
  } catch (error) {
    if (error instanceof DocumentStructureProblemError) {
      return error.problem
    }

    throw error
  }

  throw new Error('Expected a Document Structure problem')
}

function at(structure: Pick<DocumentStructure, 'children'>, path: string) {
  return findNode(structure.children, path)
}

describe('inferFromJson', () => {
  const structure = inferDocumentStructure(documentStructureOrigins.jsonDocument)

  it('infers nesting, repetitions and field types', () => {
    expect(at(structure, 'orderNumber')).toMatchObject({ kind: 'field', type: 'string' })
    expect(at(structure, 'orderDate')).toMatchObject({ type: 'date' })
    expect(at(structure, 'buyer.city')).toMatchObject({ kind: 'field', required: true })
    expect(at(structure, 'lines[]')).toMatchObject({ kind: 'array', items: { kind: 'object' } })
    expect(at(structure, 'lines[].lineNumber')).toMatchObject({ type: 'integer' })
    expect(at(structure, 'tags[]')).toMatchObject({ kind: 'array', items: { kind: 'field' } })
  })

  it('widens integers and decimals of the same field to number', () => {
    expect(at(structure, 'lines[].quantity')).toMatchObject({ type: 'number' })
  })

  it('makes null values and fields missing from some items optional', () => {
    expect(at(structure, 'note')).toMatchObject({ type: 'string', required: false })
    expect(at(structure, 'lines[].promotion')).toMatchObject({ type: 'boolean', required: false })
  })

  it('answers invalidJson for an unparseable Document', () => {
    expect(
      problemOf(() => inferDocumentStructure(documentStructureOrigins.invalidJsonDocument)),
    ).toMatchObject({ code: 'invalidJson' })
  })

  it('infers a list at the top level as one items[] list', () => {
    const list = inferFromJson('[{"orderNumber":"PO-1","total":2},{"orderNumber":"PO-2"}]')

    expect(list).toMatchObject({ format: 'json', root: 'array' })
    expect(list.children).toHaveLength(1)
    expect(at(list, 'items[]')).toMatchObject({ kind: 'array', name: 'items', required: true })
    expect(at(list, 'items[].orderNumber')).toMatchObject({ type: 'string', required: true })
    expect(at(list, 'items[].total')).toMatchObject({ type: 'integer', required: false })
  })

  it('infers the ready-made list of orders', () => {
    const list = inferDocumentStructure(documentStructureOrigins.jsonListDocument)

    expect(at(list, 'items[].total')).toMatchObject({ type: 'number', required: true })
    expect(at(list, 'items[].note')).toMatchObject({ required: false })
  })

  it('infers a top-level list of values', () => {
    expect(at(inferFromJson('["a","b"]'), 'items[]')).toMatchObject({
      kind: 'array',
      items: { kind: 'field', path: 'items[]', type: 'string' },
    })
  })

  it('infers an object as an object at the top level', () => {
    expect(structure).toMatchObject({ format: 'json', root: 'object' })
  })

  it.each([
    ['a value at the top level', '"PO-1"', 'unsupportedJson'],
    ['lists inside a top-level list', '[[1,2]]', 'unsupportedJson'],
    ['an empty list', '[]', 'emptyDocument'],
    ['lists inside lists', '{"grid":[[1,2]]}', 'unsupportedJson'],
    ['an object that is sometimes a value', '{"lines":[{"a":{"b":1}},{"a":2}]}', 'unsupportedJson'],
    ['a name with a dot', '{"order.number":"1"}', 'unsupportedJson'],
    ['an empty object', '{}', 'emptyDocument'],
  ])('rejects %s', (_, json, code) => {
    expect(problemOf(() => inferFromJson(json)).code).toBe(code)
  })

  it('points at where the values conflict', () => {
    expect(problemOf(() => inferFromJson('{"lines":[{"a":{"b":1}},{"a":2}]}')).path).toBe(
      'lines[].a',
    )
  })
})

describe('plain names', () => {
  const invoices = inferDocumentStructure(documentStructureOrigins.invoiceCsvDocument)

  it('names known ERP columns in plain words', () => {
    expect(at(invoices, 'rows[].RechNr')).toMatchObject({
      label: 'Invoice number',
      labelUnsure: false,
    })
    expect(at(invoices, 'rows[].Menge')).toMatchObject({ label: 'Quantity', labelUnsure: false })
    expect(at(invoices, 'rows[].RechNr')?.labelReason).toContain('Rechnungsnummer')
  })

  it('marks a guess unsure and tells why', () => {
    expect(at(invoices, 'rows[].EPreis')).toMatchObject({ label: 'Unit price', labelUnsure: true })
    expect(at(invoices, 'rows[].EPreis')?.labelReason).toContain('Einzelpreis')
    expect(at(invoices, 'rows[].ME')).toMatchObject({ label: 'Unit', labelUnsure: true })
  })

  it('names fields of a JSON Document regardless of how they are written', () => {
    const order = inferFromJson('{"order_number":"PO-1","GTIN":"04012345123456"}')

    expect(at(order, 'order_number')).toMatchObject({ label: 'Order number', labelUnsure: false })
    expect(at(order, 'GTIN')).toMatchObject({ label: 'Article number (GTIN)', labelUnsure: false })
  })

  it('spells out a name it does not know and marks it unsure', () => {
    const order = inferFromJson('{"deliveryWindowStart":"08:00","LAGER_ORT":"B4"}')

    expect(at(order, 'deliveryWindowStart')).toMatchObject({
      label: 'Delivery window start',
      labelUnsure: true,
    })
    expect(at(order, 'deliveryWindowStart')?.labelReason).toContain('deliveryWindowStart')
    expect(at(order, 'LAGER_ORT')).toMatchObject({ label: 'Lager ort', labelUnsure: true })
  })

  it('gives a list and its items the same plain name', () => {
    const order = inferDocumentStructure(documentStructureOrigins.jsonDocument)

    expect(at(order, 'lines[]')).toMatchObject({
      label: 'Lines',
      items: { label: 'Lines', labelUnsure: false },
    })
  })

  it('names the properties of a JSON Schema', () => {
    const article = inferDocumentStructure(documentStructureOrigins.jsonSchema)

    expect(at(article, 'articleNumber')).toMatchObject({
      label: 'Article number',
      labelUnsure: false,
    })
  })
})

describe('reading facts and sample file', () => {
  it('counts the columns and rows of a CSV Document', () => {
    expect(inferDocumentStructure(documentStructureOrigins.invoiceCsvDocument).facts).toEqual({
      columnCount: 12,
      rowCount: 3,
    })
  })

  it('counts the fields of a JSON Document and a JSON Schema', () => {
    expect(inferDocumentStructure(documentStructureOrigins.jsonDocument).facts).toEqual({
      fieldCount: 13,
    })
    expect(inferDocumentStructure(documentStructureOrigins.jsonSchema).facts).toEqual({
      fieldCount: 12,
    })
  })

  it('keeps the decoded Document as the sample file', () => {
    const takenAt = '2026-10-12T09:30:00.000Z'

    const dispatch = inferDocumentStructure(documentStructureOrigins.windows1252CsvDocument, {
      takenAt,
    })

    expect(dispatch.sample).toMatchObject({ fileName: 'lieferscheine-ansi.csv', takenAt })
    expect(dispatch.sample?.text).toContain('Königstraße 12')
  })

  it('has no sample file for a JSON Schema', () => {
    expect(inferDocumentStructure(documentStructureOrigins.jsonSchema).sample).toBeNull()
  })
})

describe('decodeText', () => {
  it('reads umlauts from a Windows-1252 Document when that encoding is chosen', () => {
    const { content } = documentStructureOrigins.windows1252CsvDocument.document

    expect(decodeText(content, 'windows-1252')).toContain('Straße')
    expect(decodeText(content, 'windows-1252')).toContain('„bitte zügig“')
  })

  it('answers unreadableContent when a Windows-1252 Document is read as UTF-8', () => {
    const { content } = documentStructureOrigins.windows1252CsvDocument.document

    expect(problemOf(() => decodeText(content, 'utf-8')).code).toBe('unreadableContent')
  })

  it('drops a UTF-8 byte order mark', () => {
    expect(decodeText(toEncodedFile('bom.csv', '﻿a;b').content, 'utf-8')).toBe('a;b')
  })
})

describe('parseCsv', () => {
  it('keeps delimiters, quotes and line breaks inside quoted cells', () => {
    const rows = parseCsv('a;b\r\n"x;y";"say ""hi""\nagain"\r\n\r\nlast;row', ';')

    expect(rows).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x;y', 'say "hi"\nagain'] },
      { line: 5, cells: ['last', 'row'] },
    ])
  })

  it('answers invalidCsv for a quote that is never closed', () => {
    expect(problemOf(() => parseCsv('a;b\n"open;c', ';'))).toMatchObject({
      code: 'invalidCsv',
      line: 2,
    })
  })
})

describe('inferFromCsv', () => {
  const settings: CsvSettings = { ...defaultCsvSettings, encoding: 'windows-1252' }
  const structure = inferDocumentStructure(documentStructureOrigins.windows1252CsvDocument)

  it('turns the rows into one repeating object of column fields', () => {
    expect(structure).toMatchObject({ format: 'csv', csv: settings })
    expect(structure.children).toHaveLength(1)
    expect(at(structure, 'rows[]')).toMatchObject({ kind: 'array', items: { kind: 'object' } })
  })

  it('names columns after the header row, umlauts included', () => {
    expect(at(structure, 'rows[].Straße')).toMatchObject({ name: 'Straße', type: 'string' })
  })

  it('infers column types and optional columns', () => {
    expect(at(structure, 'rows[].Lieferdatum')).toMatchObject({ type: 'date' })
    expect(at(structure, 'rows[].Menge')).toMatchObject({ type: 'number', required: true })
    expect(at(structure, 'rows[].GTIN')).toMatchObject({ type: 'string' })
    expect(at(structure, 'rows[].Bemerkung')).toMatchObject({ required: false })
  })

  it('numbers the columns without a header row', () => {
    const headerless = inferFromCsv('1,x\n2,y,true\n', {
      ...defaultCsvSettings,
      delimiter: ',',
      headerRow: false,
    })

    expect(at(headerless, 'rows[].column1')).toMatchObject({ type: 'integer', required: true })
    expect(at(headerless, 'rows[].column3')).toMatchObject({ type: 'boolean', required: false })
  })

  it('splits by the chosen delimiter', () => {
    const tabs = inferFromCsv('a\tb\n1\t2\n', { ...defaultCsvSettings, delimiter: '\t' })

    expect(at(tabs, 'rows[].b')).toMatchObject({ type: 'integer' })
  })

  it('keeps duplicate and dotted column names apart', () => {
    const odd = inferFromCsv('Nr.;Nr.;\n1;2;3\n', defaultCsvSettings)
    const [rows] = odd.children

    expect(rows?.kind === 'array' && rows.items.kind === 'object' && rows.items.children).toEqual([
      expect.objectContaining({ path: 'rows[].Nr_', name: 'Nr.' }),
      expect.objectContaining({ path: 'rows[].Nr__2', name: 'Nr__2' }),
      expect.objectContaining({ path: 'rows[].column3', name: 'column3' }),
    ])
  })

  it('answers emptyDocument for an empty CSV Document', () => {
    expect(
      problemOf(() => inferDocumentStructure(documentStructureOrigins.emptyCsvDocument)),
    ).toMatchObject({ code: 'emptyDocument' })
  })

  it('answers inconsistentCsvRows with the line of a row longer than the header row', () => {
    expect(problemOf(() => inferFromCsv('a;b\n1;2\n1;2;3\n', defaultCsvSettings))).toMatchObject({
      code: 'inconsistentCsvRows',
      line: 3,
    })
  })

  it('reads a large Windows-1252 export', () => {
    const large = inferDocumentStructure({
      kind: 'csvDocument',
      document: createCsvDocument({ rowCount: 20_000, encoding: 'windows-1252' }),
      csv: settings,
    })

    expect(at(large, 'rows[].Ort')).toMatchObject({ type: 'string', required: true })
    expect(at(large, 'rows[].Bemerkung')).toMatchObject({ required: false })
  })
})

describe('inferFromJsonSchema', () => {
  const structure = inferDocumentStructure(documentStructureOrigins.jsonSchema)

  it('follows properties, required and local references', () => {
    expect(at(structure, 'articleNumber')).toMatchObject({ type: 'string', required: true })
    expect(at(structure, 'supplier')).toMatchObject({ kind: 'object', required: false })
    expect(at(structure, 'supplier.gln')).toMatchObject({ required: true })
    expect(at(structure, 'prices[]')).toMatchObject({ kind: 'array', required: true })
    expect(at(structure, 'prices[].minimumQuantity')).toMatchObject({ type: 'integer' })
  })

  it('maps formats, nullable types and enums to field types', () => {
    expect(at(structure, 'validFrom')).toMatchObject({ type: 'date' })
    expect(at(structure, 'discontinued')).toMatchObject({ type: 'boolean', required: false })
    expect(at(structure, 'unit')).toMatchObject({ type: 'string' })
  })

  it('treats a required property that may be null as optional', () => {
    const nullable = inferFromJsonSchema(
      JSON.stringify({
        type: 'object',
        required: ['note'],
        properties: { note: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      }),
    )

    expect(at(nullable, 'note')).toMatchObject({ required: false })
  })

  it('merges allOf parts', () => {
    const merged = inferFromJsonSchema(
      JSON.stringify({
        allOf: [
          { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } },
          { properties: { b: { type: 'string' } } },
        ],
      }),
    )

    expect(at(merged, 'a')).toMatchObject({ type: 'integer', required: true })
    expect(at(merged, 'b')).toMatchObject({ required: false })
  })

  it.each([
    ['text that is not JSON', 'type: object', 'invalidJsonSchema'],
    ['properties that are not an object', '{"type":"object","properties":[]}', 'invalidJsonSchema'],
    [
      'an unknown type',
      '{"type":"object","properties":{"a":{"type":"money"}}}',
      'invalidJsonSchema',
    ],
    ['no properties', '{"type":"object"}', 'invalidJsonSchema'],
    ['a value at the top level', '{"type":"string"}', 'unsupportedJsonSchema'],
    [
      'an external reference',
      '{"properties":{"a":{"$ref":"other.json#/a"}}}',
      'unsupportedJsonSchema',
    ],
    [
      'a recursive reference',
      '{"properties":{"node":{"$ref":"#/$defs/node"}},"$defs":{"node":{"properties":{"child":{"$ref":"#/$defs/node"}}}}}',
      'unsupportedJsonSchema',
    ],
  ])('rejects %s', (_, schema, code) => {
    expect(problemOf(() => inferFromJsonSchema(schema)).code).toBe(code)
  })

  it('infers a list at the top level as one items[] list', () => {
    const list = inferFromJsonSchema(
      JSON.stringify({
        type: 'array',
        items: {
          type: 'object',
          required: ['articleNumber'],
          properties: { articleNumber: { type: 'string' }, price: { type: 'number' } },
        },
      }),
    )

    expect(list).toMatchObject({ format: 'json', root: 'array' })
    expect(list.children).toHaveLength(1)
    expect(at(list, 'items[]')).toMatchObject({ kind: 'array', required: true })
    expect(at(list, 'items[].articleNumber')).toMatchObject({ required: true })
    expect(at(list, 'items[].price')).toMatchObject({ type: 'number', required: false })
  })

  it('answers invalidJsonSchema for the broken example', () => {
    expect(
      problemOf(() => inferDocumentStructure(documentStructureOrigins.invalidJsonSchema)),
    ).toMatchObject({ code: 'invalidJsonSchema' })
  })
})

describe('adjustDocumentStructure', () => {
  const order = seedDocumentStructureOf.ORDERS

  function adjust(adjustments: Parameters<typeof adjustDocumentStructure>[1]['adjustments']) {
    return adjustDocumentStructure(order, { name: order.name, adjustments })
  }

  it('renames the structure', () => {
    expect(adjustDocumentStructure(order, { name: 'Order', adjustments: [] }).name).toBe('Order')
  })

  it('marks a field optional and changes its type', () => {
    const adjusted = adjust([{ path: 'orderNumber', required: false, type: 'integer' }])

    expect(at(adjusted, 'orderNumber')).toMatchObject({ required: false, type: 'integer' })
  })

  it('turns an object into a repeating list and moves its fields below it', () => {
    const adjusted = adjust([
      { path: 'buyer', repeating: true },
      { path: 'buyer.gln', required: false },
    ])

    expect(at(adjusted, 'buyer[]')).toMatchObject({
      kind: 'array',
      required: true,
      items: { kind: 'object', path: 'buyer[]', required: true },
    })
    expect(at(adjusted, 'buyer[].gln')).toMatchObject({ required: false })
    expect(at(adjusted, 'buyer.gln')).toBeUndefined()
  })

  it('turns a repeating list back into one object and keeps the list required-ness', () => {
    const adjusted = adjust([{ path: 'lines[]', repeating: false, required: false }])

    expect(at(adjusted, 'lines')).toMatchObject({ kind: 'object', required: false })
    expect(at(adjusted, 'lines.gtin')).toMatchObject({ kind: 'field' })
  })

  it('turns a field into a repeating list of values', () => {
    const adjusted = adjust([{ path: 'note', repeating: true }])

    expect(at(adjusted, 'note[]')).toMatchObject({
      kind: 'array',
      items: { kind: 'field', path: 'note[]', type: 'string' },
    })
  })

  it('answers unknownPath for a node it does not have', () => {
    expect(problemOf(() => adjust([{ path: 'buyer.iban', required: false }]))).toMatchObject({
      code: 'unknownPath',
      path: 'buyer.iban',
    })
  })

  it('answers notAdjustable for a type on an object', () => {
    expect(problemOf(() => adjust([{ path: 'buyer', type: 'string' }])).code).toBe('notAdjustable')
  })

  const csv = inferDocumentStructure(documentStructureOrigins.csvDocument)

  const csvStructure = documentStructureSchema.parse({
    id: crypto.randomUUID(),
    name: 'Dispatch',
    ...csv,
  })

  it('keeps the rows of a CSV structure from nesting or repeating', () => {
    for (const adjustment of [
      { path: 'rows[]', repeating: false },
      { path: 'rows[].Menge', repeating: true },
    ]) {
      expect(
        problemOf(() =>
          adjustDocumentStructure(csvStructure, { name: 'Dispatch', adjustments: [adjustment] }),
        ).code,
      ).toBe('notAdjustable')
    }
  })

  it('changes column types of a CSV structure', () => {
    const adjusted = adjustDocumentStructure(csvStructure, {
      name: 'Dispatch',
      csv: defaultCsvSettings,
      adjustments: [{ path: 'rows[].Menge', type: 'integer', required: false }],
    })

    expect(at(adjusted, 'rows[].Menge')).toMatchObject({ type: 'integer', required: false })
  })

  it('answers csvDocumentRequired for new CSV settings without a CSV Document', () => {
    expect(
      problemOf(() =>
        adjustDocumentStructure(csvStructure, {
          name: 'Dispatch',
          csv: { ...defaultCsvSettings, headerRow: false },
          adjustments: [],
        }),
      ).code,
    ).toBe('csvDocumentRequired')
  })

  it('reads the CSV Document of the update again with the new CSV settings', () => {
    const csv: CsvSettings = { delimiter: ',', headerRow: false, encoding: 'windows-1252' }

    const adjusted = adjustDocumentStructure(csvStructure, {
      name: 'Dispatch',
      csv,
      document: toEncodedFile('dispatch.csv', 'LS-1,Straße 1,24\r\nLS-2,,12\r\n', 'windows-1252'),
      adjustments: [{ path: 'rows[].column3', type: 'number' }],
    })

    expect(adjusted).toMatchObject({ id: csvStructure.id, name: 'Dispatch', csv })
    expect(at(adjusted, 'rows[].Menge')).toBeUndefined()
    expect(at(adjusted, 'rows[].column2')).toMatchObject({ required: false })
    expect(at(adjusted, 'rows[].column3')).toMatchObject({ type: 'number' })
  })

  it('answers the problems of the CSV Document of the update', () => {
    expect(
      problemOf(() =>
        adjustDocumentStructure(csvStructure, {
          name: 'Dispatch',
          document: toEncodedFile('empty.csv', '\r\n'),
          adjustments: [],
        }),
      ).code,
    ).toBe('emptyDocument')
  })

  it('keeps the items[] list of a JSON list repeating', () => {
    const list = documentStructureSchema.parse({
      id: crypto.randomUUID(),
      name: 'Orders',
      ...inferFromJson('[{"orderNumber":"PO-1"}]'),
    })

    expect(
      problemOf(() =>
        adjustDocumentStructure(list, {
          name: 'Orders',
          adjustments: [{ path: 'items[]', repeating: false }],
        }),
      ),
    ).toMatchObject({ code: 'notAdjustable', path: 'items[]' })
    expect(
      at(
        adjustDocumentStructure(list, {
          name: 'Orders',
          adjustments: [{ path: 'items[].orderNumber', required: false }],
        }),
        'items[].orderNumber',
      ),
    ).toMatchObject({ required: false })
  })

  it('refuses CSV settings on a JSON structure', () => {
    expect(
      problemOf(() =>
        adjustDocumentStructure(order, {
          name: order.name,
          csv: defaultCsvSettings,
          adjustments: [],
        }),
      ).code,
    ).toBe('notAdjustable')
  })

  it('renames a field by hand, which leaves it without a reason and no longer unsure', () => {
    const adjusted = adjust([{ path: 'lines[].quantity', label: 'Ordered quantity' }])

    expect(at(adjusted, 'lines[].quantity')).toMatchObject({
      label: 'Ordered quantity',
      labelReason: null,
      labelUnsure: false,
    })
  })

  it('keeps the reason of a plain name it confirms', () => {
    const invoices = documentStructureSchema.parse({
      id: crypto.randomUUID(),
      name: 'Invoices',
      ...inferDocumentStructure(documentStructureOrigins.invoiceCsvDocument),
    })

    const confirmed = adjustDocumentStructure(invoices, {
      name: 'Invoices',
      adjustments: [{ path: 'rows[].EPreis', label: 'Unit price' }],
    })

    expect(at(confirmed, 'rows[].EPreis')).toMatchObject({
      label: 'Unit price',
      labelReason: at(invoices, 'rows[].EPreis')?.labelReason,
      labelUnsure: false,
    })
  })

  it('renames a list together with its items', () => {
    expect(at(adjust([{ path: 'lines[]', label: 'Order lines' }]), 'lines[]')).toMatchObject({
      label: 'Order lines',
      items: { label: 'Order lines', labelReason: null },
    })
  })

  it('keeps a new plain name when a list turns into one object', () => {
    expect(
      at(adjust([{ path: 'lines[]', label: 'Order lines', repeating: false }]), 'lines'),
    ).toMatchObject({ kind: 'object', label: 'Order lines' })
  })

  it('keeps the plain names of the columns when a CSV Document is read again', () => {
    const renamed = adjustDocumentStructure(csvStructure, {
      name: 'Dispatch',
      adjustments: [{ path: 'rows[].Menge', label: 'Delivered quantity' }],
    })

    const reread = adjustDocumentStructure(renamed, {
      name: 'Dispatch',
      document: createCsvDocument({ rowCount: 3 }),
      adjustments: [],
    })

    expect(at(reread, 'rows[].Menge')).toMatchObject({ label: 'Delivered quantity' })
    expect(reread.sample).toMatchObject({ fileName: 'lieferscheine-3.csv' })
  })

  it('leaves a structure without adjustments as it was', () => {
    const nodes = (structure: { children: DocumentStructureNode[] }) => structure.children

    expect(nodes(adjust([]))).toEqual(nodes(order))
  })
})
