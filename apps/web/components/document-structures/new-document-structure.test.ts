import { describe, expect, it } from 'vitest'

import {
  defaultCsvSettings,
  type DocumentField,
  type DocumentStructureNode,
  type EncodedFile,
  fieldNamesNotices,
} from '@edi-bridge/contracts'

import { encodeBase64 } from './document-file'
import {
  fileFacts,
  keptChoices,
  labelsToCheck,
  labelsToSave,
  readingSteps,
  readProgress,
  saveBlock,
  unsureLabelCount,
} from './new-document-structure'

function encoded(fileName: string, text: string): EncodedFile {
  return { fileName, content: encodeBase64(new TextEncoder().encode(text)) }
}

function field(path: string, label: string, labelUnsure = false): DocumentField {
  return {
    path,
    name: path.split('.').at(-1)!,
    label,
    labelReason: 'Read from the column name.',
    labelUnsure,
    required: true,
    kind: 'field',
    type: 'string',
  }
}

const invoiceRows: DocumentStructureNode[] = [
  {
    path: 'rows[]',
    name: 'rows',
    label: 'Rows',
    labelReason: 'Each line of the file.',
    labelUnsure: false,
    required: true,
    kind: 'array',
    items: {
      path: 'rows[]',
      name: 'rows',
      label: 'Rows',
      labelReason: 'Each line of the file.',
      labelUnsure: false,
      required: true,
      kind: 'object',
      children: [
        field('rows[].RechNr', 'Invoice number'),
        field('rows[].ME', 'Unit', true),
        field('rows[].EPreis', 'Unit price', true),
      ],
    },
  },
]

describe('labelsToCheck', () => {
  it('lists the unsure labels nobody has confirmed or renamed yet, in file order', () => {
    expect(labelsToCheck(invoiceRows, new Map()).map(({ path }) => path)).toEqual([
      'rows[].ME',
      'rows[].EPreis',
    ])
  })

  it('drops a label once it is confirmed or renamed', () => {
    const choices = new Map([['rows[].EPreis', 'Price per unit']])

    expect(labelsToCheck(invoiceRows, choices).map(({ path }) => path)).toEqual(['rows[].ME'])
  })
})

describe('labelsToSave', () => {
  const aiNamed = { children: invoiceRows, fieldNamesNotice: null }

  it('keeps every name and reason of the AI the user did not change', () => {
    expect(labelsToSave(aiNamed, new Map())).toEqual([
      { path: 'rows[]', label: 'Rows', labelReason: 'Each line of the file.' },
      { path: 'rows[].RechNr', label: 'Invoice number', labelReason: 'Read from the column name.' },
      { path: 'rows[].ME', label: 'Unit', labelReason: 'Read from the column name.' },
      { path: 'rows[].EPreis', label: 'Unit price', labelReason: 'Read from the column name.' },
    ])
  })

  it('names a renamed node by hand and keeps the reason when the AI name is chosen again', () => {
    const choices = new Map([
      ['rows[].ME', 'Unit'],
      ['rows[].EPreis', 'Price per unit'],
    ])

    expect(labelsToSave(aiNamed, choices).slice(2)).toEqual([
      { path: 'rows[].ME', label: 'Unit', labelReason: 'Read from the column name.' },
      { path: 'rows[].EPreis', label: 'Price per unit', labelReason: null },
    ])
  })

  it('sends only the choices when the fields were named without AI', () => {
    const withoutAi = {
      children: invoiceRows,
      fieldNamesNotice: fieldNamesNotices.aiBudgetExhausted,
    }

    const choices = new Map([['rows[].EPreis', 'Price per unit']])

    expect(labelsToSave(withoutAi, choices)).toEqual([
      { path: 'rows[].EPreis', label: 'Price per unit' },
    ])
  })
})

describe('unsureLabelCount', () => {
  it('counts every unsure label, checked or not', () => {
    expect(unsureLabelCount(invoiceRows)).toBe(2)
  })
})

describe('keptChoices', () => {
  function rowsWith(...fields: DocumentField[]): DocumentStructureNode[] {
    const [rows] = invoiceRows

    if (rows?.kind !== 'array' || rows.items.kind !== 'object') {
      throw new Error('invoiceRows has no row list')
    }

    return [{ ...rows, items: { ...rows.items, children: fields } }]
  }

  const choices = new Map([
    ['rows[].ME', 'Unit'],
    ['rows[].EPreis', 'Price per unit'],
  ])

  it('keeps every choice whose field is read again with the same label', () => {
    expect(keptChoices(choices, invoiceRows, invoiceRows)).toEqual(choices)
  })

  it('drops the choices whose field is gone after reading the file again', () => {
    const next = rowsWith(
      field('rows[].RechNr', 'Invoice number'),
      field('rows[].ME', 'Unit', true),
    )

    expect(keptChoices(choices, invoiceRows, next)).toEqual(new Map([['rows[].ME', 'Unit']]))
  })

  it('drops a confirmation once the field gets another label, but keeps a rename', () => {
    const next = rowsWith(
      field('rows[].ME', 'Measure', true),
      field('rows[].EPreis', 'Price', true),
    )

    expect(keptChoices(choices, invoiceRows, next)).toEqual(
      new Map([['rows[].EPreis', 'Price per unit']]),
    )
  })
})

describe('readProgress', () => {
  const chosen = { kind: 'csvDocument', file: encoded('invoices.csv', 'RechNr\r\nR-1') } as const
  const facts = { format: 'csv', columnCount: 1, rowCount: 1 } as const

  it('is opening the file until it is chosen', () => {
    expect(readProgress({ chosen: null, facts: null, inferred: null })).toBe('opening')
  })

  it('names the fields once the file itself shows them', () => {
    expect(readProgress({ chosen, facts, inferred: null })).toBe('naming')
  })

  it('leaves finding the fields to the inference when the file cannot be counted', () => {
    expect(readProgress({ chosen, facts: null, inferred: null })).toBe('finding')
  })

  it('is read once the inference answers', () => {
    expect(
      readProgress({
        chosen,
        facts,
        inferred: {
          format: 'csv',
          csv: defaultCsvSettings,
          facts: { columnCount: 1, rowCount: 1 },
          sample: null,
          children: invoiceRows,
        },
      }),
    ).toBe('read')
  })
})

describe('readingSteps', () => {
  it('opens the file before anything else', () => {
    expect(readingSteps('opening')).toEqual([
      { key: 'opening', state: 'active' },
      { key: 'finding', state: 'pending' },
      { key: 'naming', state: 'pending' },
    ])
  })

  it('finds the fields once the file is open', () => {
    expect(readingSteps('finding')).toEqual([
      { key: 'opening', state: 'done' },
      { key: 'finding', state: 'active' },
      { key: 'naming', state: 'pending' },
    ])
  })

  it('names the fields once they are found', () => {
    expect(readingSteps('naming')).toEqual([
      { key: 'opening', state: 'done' },
      { key: 'finding', state: 'done' },
      { key: 'naming', state: 'active' },
    ])
  })

  it('has every step done once the file is read', () => {
    expect(readingSteps('read').map(({ state }) => state)).toEqual(['done', 'done', 'done'])
  })
})

describe('saveBlock', () => {
  it('asks to check the labels first while any is left', () => {
    expect(saveBlock(2, '')).toEqual({ reason: 'labels', count: 2 })
  })

  it('asks for a name once every label is checked', () => {
    expect(saveBlock(0, '   ')).toEqual({ reason: 'name' })
  })

  it('lets a named document structure with every label checked be saved', () => {
    expect(saveBlock(0, 'Invoice export')).toBeNull()
  })
})

describe('fileFacts', () => {
  const invoiceCsv = encoded(
    'invoices.csv',
    'RechNr;ME;EPreis\r\nR-1;Stk;"1,50"\r\nR-2;kg;"2,00"\r\n\r\nR-3;Stk;3\r\n',
  )

  it('counts the columns and the rows below the header row of a CSV file', () => {
    expect(fileFacts('csvDocument', invoiceCsv, defaultCsvSettings)).toEqual({
      format: 'csv',
      columnCount: 3,
      rowCount: 3,
    })
  })

  it('counts every row of a CSV file without a header row', () => {
    expect(
      fileFacts('csvDocument', invoiceCsv, { ...defaultCsvSettings, headerRow: false }),
    ).toEqual({ format: 'csv', columnCount: 3, rowCount: 4 })
  })

  it('reads a CSV file with the chosen delimiter', () => {
    expect(fileFacts('csvDocument', invoiceCsv, { ...defaultCsvSettings, delimiter: ',' })).toEqual(
      { format: 'csv', columnCount: 1, rowCount: 3 },
    )
  })

  it('counts the fields of a JSON file once for every element of a list', () => {
    const order = encoded(
      'order.json',
      JSON.stringify({
        orderNumber: 'PO-1',
        buyer: { name: 'Muster GmbH', city: null },
        lines: [
          { sku: 'A-1', quantity: 2 },
          { sku: 'B-2', note: 'fragile' },
        ],
        tags: ['urgent'],
      }),
    )

    expect(fileFacts('jsonDocument', order, defaultCsvSettings)).toEqual({
      format: 'json',
      fieldCount: 7,
    })
  })

  it('counts the properties a JSON Schema describes', () => {
    const schema = encoded(
      'article.schema.json',
      JSON.stringify({
        type: 'object',
        properties: {
          sku: { type: 'string' },
          prices: {
            type: 'array',
            items: { type: 'object', properties: { amount: {}, currency: {} } },
          },
        },
      }),
    )

    expect(fileFacts('jsonSchema', schema, defaultCsvSettings)).toEqual({
      format: 'json',
      fieldCount: 3,
    })
  })

  it('finds nothing in a file that is not JSON, so the inference decides', () => {
    expect(
      fileFacts('jsonDocument', encoded('broken.json', '{ "a": '), defaultCsvSettings),
    ).toBeNull()
  })
})
