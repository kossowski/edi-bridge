import { describe, expect, it } from 'vitest'

import { applyLookupTableImport, classifyLookupTableImport } from './lookup-table-import'

import type { LookupTableEntry } from './lookup-table'

const units: LookupTableEntry[] = [
  { sourceCode: 'ST', targetCode: 'PCE' },
  { sourceCode: 'STK', targetCode: 'PCE' },
  { sourceCode: 'KG', targetCode: 'KGM' },
  { sourceCode: 'L', targetCode: 'LTR' },
]

describe('classifyLookupTableImport', () => {
  it('classifies each row against the entries', () => {
    const csv = [
      'Source code;Target code',
      'ST;PCE',
      'KG;KGS',
      'KAR;CT',
      '',
      ';BX',
      'KAR;BX',
      '"Paket; groß";PK',
      'X;Y;Z',
      'L;',
    ].join('\r\n')

    expect(classifyLookupTableImport(units, csv)).toEqual([
      { line: 2, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
      {
        line: 3,
        status: 'changed',
        sourceCode: 'KG',
        targetCode: 'KGS',
        previousTargetCode: 'KGM',
      },
      { line: 4, status: 'added', sourceCode: 'KAR', targetCode: 'CT' },
      { line: 6, status: 'invalid', cells: ['', 'BX'], reasons: ['sourceCodeMissing'] },
      { line: 7, status: 'invalid', cells: ['KAR', 'BX'], reasons: ['duplicateSourceCode'] },
      { line: 8, status: 'added', sourceCode: 'Paket; groß', targetCode: 'PK' },
      { line: 9, status: 'invalid', cells: ['X', 'Y', 'Z'], reasons: ['columnCount'] },
      { line: 10, status: 'invalid', cells: ['L', ''], reasons: ['targetCodeMissing'] },
    ])
  })

  it('reads comma-separated rows without a header', () => {
    expect(classifyLookupTableImport(units, 'STK,PCE\n"BX ""large""",BX\n')).toEqual([
      { line: 1, status: 'unchanged', sourceCode: 'STK', targetCode: 'PCE' },
      { line: 2, status: 'added', sourceCode: 'BX "large"', targetCode: 'BX' },
    ])
  })

  it('reads tab-separated rows under a German header', () => {
    expect(classifyLookupTableImport(units, 'Quellcode\tZielcode\nKAR\tCT')).toEqual([
      { line: 2, status: 'added', sourceCode: 'KAR', targetCode: 'CT' },
    ])
  })

  it('matches the first row of a file that starts with a byte order mark', () => {
    expect(classifyLookupTableImport(units, '﻿ST;PCE\r\nKG;KGM')).toEqual([
      { line: 1, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
      { line: 2, status: 'unchanged', sourceCode: 'KG', targetCode: 'KGM' },
    ])
  })

  it('rejects codes longer than the limit', () => {
    const long = 'X'.repeat(71)

    expect(classifyLookupTableImport(units, `${long};${long}`)).toEqual([
      {
        line: 1,
        status: 'invalid',
        cells: [long, long],
        reasons: ['sourceCodeTooLong', 'targetCodeTooLong'],
      },
    ])
  })

  it('finds no rows in an empty file', () => {
    expect(classifyLookupTableImport(units, '')).toEqual([])
  })
})

describe('applyLookupTableImport', () => {
  it('adds and changes the valid rows and keeps the other entries', () => {
    const rows = classifyLookupTableImport(units, 'KG;KGS\nKAR;CT\n;BX\nST;PCE')

    expect(applyLookupTableImport(units, rows)).toEqual([
      { sourceCode: 'ST', targetCode: 'PCE' },
      { sourceCode: 'STK', targetCode: 'PCE' },
      { sourceCode: 'KG', targetCode: 'KGS' },
      { sourceCode: 'L', targetCode: 'LTR' },
      { sourceCode: 'KAR', targetCode: 'CT' },
    ])
  })
})
