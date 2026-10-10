import { describe, expect, it } from 'vitest'

import { createCsvDocument, documentStructureOrigins } from '@edi-bridge/mocks'

import type { DocumentStructureNode } from '@edi-bridge/contracts'

import {
  csvColumnNames,
  decodeFirstBytes,
  firstRowCount,
  firstRows,
  sameCsvSettings,
  splitRows,
} from './csv-text'

import type { StructureTree } from './structure-tree'

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

  it('skips the header row once the columns are known', () => {
    const text = 'Ort;GTIN\nLübeck;0401\nKöln;0402'

    expect(firstRows(text, semicolons, ['Ort', 'GTIN'])).toEqual([
      ['Lübeck', '0401'],
      ['Köln', '0402'],
    ])
    expect(firstRows(text, { ...semicolons, headerRow: false }, ['column1', 'column2'])).toEqual([
      ['Ort', 'GTIN'],
      ['Lübeck', '0401'],
      ['Köln', '0402'],
    ])
  })

  it('keeps the header row while the columns are unknown', () => {
    expect(firstRows('Ort;GTIN\nLübeck;0401', semicolons, null)).toEqual([
      ['Ort', 'GTIN'],
      ['Lübeck', '0401'],
    ])
  })

  it('keeps only the first rows', () => {
    const text = Array.from({ length: 50 }, (_, row) => `r${row}`).join('\n')

    expect(firstRows(text, semicolons, ['r0'])).toHaveLength(firstRowCount)
    expect(firstRows(text, semicolons, null)).toHaveLength(firstRowCount + 1)
    expect(firstRows('', semicolons, null)).toEqual([])
  })

  it('takes the column names from the inferred tree', () => {
    const column = (name: string): DocumentStructureNode => ({
      kind: 'field',
      path: `rows[].${name}`,
      name,
      type: 'string',
      required: true,
    })

    const tree: StructureTree = {
      format: 'csv',
      children: [
        {
          kind: 'array',
          path: 'rows[]',
          name: 'rows',
          required: true,
          items: {
            kind: 'object',
            path: 'rows[]',
            name: 'rows',
            required: true,
            children: [column('Ort'), column('column2')],
          },
        },
      ],
    }

    expect(csvColumnNames(tree)).toEqual(['Ort', 'column2'])
    expect(csvColumnNames({ format: 'json', children: [] })).toBeNull()
  })

  it('compares CSV settings', () => {
    expect(sameCsvSettings(semicolons, { ...semicolons })).toBe(true)
    expect(sameCsvSettings(semicolons, { ...semicolons, encoding: 'windows-1252' })).toBe(false)
  })
})
