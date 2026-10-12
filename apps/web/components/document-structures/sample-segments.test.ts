import { describe, expect, it } from 'vitest'

import { csvSampleRows, jsonSampleSegments } from './sample-segments'

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
