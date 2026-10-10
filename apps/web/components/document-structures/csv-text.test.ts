import { describe, expect, it } from 'vitest'

import { createCsvDocument, documentStructureOrigins } from '@edi-bridge/mocks'

import { decodeFirstBytes, firstRowCount, firstRows, sameCsvSettings, splitRows } from './csv-text'

const ansi = documentStructureOrigins.windows1252CsvDocument.document

const semicolons = { delimiter: ';', headerRow: true, encoding: 'utf-8' } as const

describe('CSV text', () => {
  it('decodes umlauts only with the right encoding', () => {
    expect(decodeFirstBytes(ansi, 'windows-1252')).toContain('Lübeck')
    expect(decodeFirstBytes(ansi, 'windows-1252')).toContain('„bitte zügig“')
    expect(decodeFirstBytes(ansi, 'utf-8')).toContain('L�beck')

    const utf8 = documentStructureOrigins.csvDocument.document

    expect(decodeFirstBytes(utf8, 'windows-1252')).toContain('LÃ¼beck')
  })

  it('decodes only the first bytes of a large Document', () => {
    const large = createCsvDocument({ rowCount: 20_000 })

    expect(decodeFirstBytes(large, 'utf-8').length).toBeLessThan(50_000)
  })

  it('splits rows with quoted cells and stops at the limit', () => {
    expect(splitRows('a;"b;""c"""\r\n\r\nd;e\nf', ';', 5)).toEqual([
      ['a', 'b;"c"'],
      ['d', 'e'],
      ['f'],
    ])
    expect(splitRows('a\nb\nc', ';', 2)).toEqual([['a'], ['b']])
    expect(splitRows('"open\nquote', ';', 5)).toEqual([['open\nquote']])
  })

  it('names the columns from the header row', () => {
    const text = 'Ort;GTIN;\nLübeck;0401;x\nKöln;0402;y'

    expect(firstRows(text, semicolons)).toEqual({
      columns: ['Ort', 'GTIN', 'column3'],
      rows: [
        ['Lübeck', '0401', 'x'],
        ['Köln', '0402', 'y'],
      ],
    })
  })

  it('numbers the columns without a header row', () => {
    expect(firstRows('Ort;GTIN\nLübeck;0401', { ...semicolons, headerRow: false })).toEqual({
      columns: ['column1', 'column2'],
      rows: [
        ['Ort', 'GTIN'],
        ['Lübeck', '0401'],
      ],
    })
  })

  it('shows one column when the delimiter does not match', () => {
    const { columns, rows } = firstRows('a;b\n1;2', { ...semicolons, delimiter: ',' })

    expect(columns).toEqual(['a;b'])
    expect(rows).toEqual([['1;2']])
  })

  it('keeps only the first rows', () => {
    const text = Array.from({ length: 50 }, (_, row) => `r${row}`).join('\n')

    expect(firstRows(text, semicolons).rows).toHaveLength(firstRowCount)
    expect(firstRows('', semicolons)).toEqual({ columns: [], rows: [] })
  })

  it('compares CSV settings', () => {
    expect(sameCsvSettings(semicolons, { ...semicolons })).toBe(true)
    expect(sameCsvSettings(semicolons, { ...semicolons, encoding: 'windows-1252' })).toBe(false)
  })
})
