import { describe, expect, it } from 'vitest'

import type { DocumentField, DocumentStructure } from '@edi-bridge/contracts'

import {
  csvSampleRows,
  firstValues,
  jsonSampleSegments,
  pathWithin,
  sampleContent,
} from './sample-segments'

function values(segments: ReturnType<typeof jsonSampleSegments>) {
  return segments?.flatMap((segment) =>
    segment.path === null ? [] : [[segment.path, segment.text]],
  )
}

describe('jsonSampleSegments', () => {
  it('keys each value of a JSON Document by the path of its node', () => {
    const segments = jsonSampleSegments('{"orderNumber":"PO-1","buyer":{"gln":"4012345000016"}}')

    expect(segments?.map(({ text }) => text).join('')).toBe(
      [
        '{',
        '  "orderNumber": "PO-1",',
        '  "buyer": {',
        '    "gln": "4012345000016"',
        '  }',
        '}',
      ].join('\n'),
    )
    expect(values(segments)).toEqual([
      ['orderNumber', '"PO-1"'],
      ['buyer.gln', '"4012345000016"'],
    ])
  })

  it('gives the values of every array element the path of the array', () => {
    const segments = jsonSampleSegments(
      JSON.stringify({ lines: [{ gtin: '1', quantity: 24 }, { gtin: '2' }], tags: ['express'] }),
    )

    expect(values(segments)).toEqual([
      ['lines[].gtin', '"1"'],
      ['lines[].quantity', '24'],
      ['lines[].gtin', '"2"'],
      ['tags[]', '"express"'],
    ])
  })

  it('keys a list at the top level under items', () => {
    const segments = jsonSampleSegments('[{"total":45.36,"note":null},[]]')

    expect(values(segments)).toEqual([
      ['items[].total', '45.36'],
      ['items[].note', 'null'],
    ])
    expect(segments?.map(({ text }) => text).join('')).toBe(
      ['[', '  {', '    "total": 45.36,', '    "note": null', '  },', '  []', ']'].join('\n'),
    )
  })

  it('reads nothing from a file that is not JSON', () => {
    expect(jsonSampleSegments('{"orderNumber":')).toBeNull()
  })
})

describe('csvSampleRows', () => {
  const text = [
    'RechNr;Bezeichnung;EPreis',
    'R-1;"Haferdrink; 1 l";4,20',
    'R-2;Dinkeldrink;3,10',
    'R-3;Reisdrink;2,90',
  ].join('\r\n')

  const columns = ['rows[].RechNr', 'rows[].Bezeichnung', 'rows[].EPreis']
  const settings = { delimiter: ';', headerRow: true, encoding: 'utf-8' } as const

  it('keys each cell by the path of its column and leaves out the header row', () => {
    expect(csvSampleRows(text, settings, columns, 2)).toEqual({
      rowCount: 3,
      rows: [
        [
          { text: 'R-1', path: 'rows[].RechNr' },
          { text: 'Haferdrink; 1 l', path: 'rows[].Bezeichnung' },
          { text: '4,20', path: 'rows[].EPreis' },
        ],
        [
          { text: 'R-2', path: 'rows[].RechNr' },
          { text: 'Dinkeldrink', path: 'rows[].Bezeichnung' },
          { text: '3,10', path: 'rows[].EPreis' },
        ],
      ],
    })
  })

  it('reads the first row as data without a header row and keys extra cells by no path', () => {
    const { rows, rowCount } = csvSampleRows(
      'a;b;c\nd;e;f',
      { ...settings, headerRow: false },
      columns.slice(0, 2),
      5,
    )

    expect(rowCount).toBe(2)
    expect(rows[0]).toEqual([
      { text: 'a', path: 'rows[].RechNr' },
      { text: 'b', path: 'rows[].Bezeichnung' },
      { text: 'c', path: null },
    ])
  })
})

const named = { labelReason: null, labelUnsure: false, required: true }

function column(name: string, label: string): DocumentField {
  return { ...named, kind: 'field', type: 'string', path: `rows[].${name}`, name, label }
}

const invoiceExport: DocumentStructure = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'ERP invoice export (CSV)',
  format: 'csv',
  csv: { delimiter: ';', headerRow: true, encoding: 'utf-8' },
  sample: null,
  children: [
    {
      ...named,
      kind: 'array',
      path: 'rows',
      name: 'rows',
      label: 'Rows',
      items: {
        ...named,
        kind: 'object',
        path: 'rows[]',
        name: 'rows',
        label: 'Rows',
        children: [column('RechNr', 'Invoice number'), column('EPreis', 'Unit price')],
      },
    },
  ],
}

const sampleOf = (text: string) => ({
  fileName: 'export.csv',
  text,
  takenAt: '2026-10-08T08:00:00.000Z',
})

describe('sampleContent', () => {
  it('shows a CSV sample as the columns of the Document Structure with their cells', () => {
    expect(sampleContent(invoiceExport, sampleOf('RechNr;EPreis\nR-1;4,20'))).toEqual({
      kind: 'csv',
      columns: [
        { path: 'rows[].RechNr', name: 'RechNr' },
        { path: 'rows[].EPreis', name: 'EPreis' },
      ],
      rowCount: 1,
      rows: [
        [
          { text: 'R-1', path: 'rows[].RechNr' },
          { text: '4,20', path: 'rows[].EPreis' },
        ],
      ],
    })
  })

  it('shows at most 50 rows of a CSV sample and counts all of them', () => {
    const rows = Array.from({ length: 60 }, (_, index) => `R-${index};1,00`)
    const content = sampleContent(invoiceExport, sampleOf(['RechNr;EPreis', ...rows].join('\n')))

    expect(content.kind === 'csv' && [content.rows.length, content.rowCount]).toEqual([50, 60])
  })

  it('shows a JSON sample value by value', () => {
    const order: DocumentStructure = {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'ERP purchase order',
      format: 'json',
      root: 'object',
      sample: null,
      children: [
        {
          ...named,
          kind: 'field',
          type: 'string',
          path: 'orderNumber',
          name: 'orderNumber',
          label: 'Order number',
        },
      ],
    }

    expect(sampleContent(order, sampleOf('{"orderNumber":"PO-1"}'))).toEqual({
      kind: 'json',
      segments: [
        { text: '{\n  "orderNumber": ', path: null },
        { text: '"PO-1"', path: 'orderNumber' },
        { text: '\n}', path: null },
      ],
    })
    expect(sampleContent(order, sampleOf('{"orderNumber":'))).toEqual({ kind: 'text' })
  })
})

describe('firstValues', () => {
  it('takes the first filled value of each field', () => {
    const content = sampleContent(
      invoiceExport,
      sampleOf('RechNr;EPreis\nR-1;\nR-2;4,20\nR-3;3,10'),
    )

    expect(firstValues(content)).toEqual(
      new Map([
        ['rows[].RechNr', 'R-1'],
        ['rows[].EPreis', '4,20'],
      ]),
    )
  })

  it('has no values for a sample shown as text', () => {
    expect(firstValues({ kind: 'text' })).toEqual(new Map())
  })
})

describe('pathWithin', () => {
  it('finds a value at the selected field', () => {
    expect(pathWithin('buyer.gln', 'buyer.gln')).toBe(true)
  })

  it('finds the values beneath a selected object or array', () => {
    expect(pathWithin('buyer.gln', 'buyer')).toBe(true)
    expect(pathWithin('rows[].EPreis', 'rows')).toBe(true)
    expect(pathWithin('tags[]', 'tags')).toBe(true)
  })

  it('leaves out fields whose name only starts like the selected one', () => {
    expect(pathWithin('buyerName', 'buyer')).toBe(false)
    expect(pathWithin('buyer', 'buyer.gln')).toBe(false)
  })
})
