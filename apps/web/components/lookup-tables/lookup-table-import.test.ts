import { describe, expect, it } from 'vitest'

import { lookupTableImportReasons, maxLookupTableCsvLength } from '@edi-bridge/contracts'

import type { LookupTableImportRow } from '@edi-bridge/contracts'

import messagesDe from '../../messages/de.json'
import messagesEn from '../../messages/en.json'
import { checkCsv, countByStatus, hasChanges, rowsWithStatus } from './lookup-table-import'

const rows: LookupTableImportRow[] = [
  { line: 2, status: 'added', sourceCode: 'MTR', targetCode: 'MTR' },
  { line: 3, status: 'changed', sourceCode: 'KG', targetCode: 'KGS', previousTargetCode: 'KGM' },
  { line: 4, status: 'unchanged', sourceCode: 'ST', targetCode: 'PCE' },
  { line: 5, status: 'invalid', cells: ['', 'LTR'], reasons: ['sourceCodeMissing'] },
  { line: 6, status: 'added', sourceCode: 'CMT', targetCode: 'CMT' },
]

describe('countByStatus', () => {
  it('counts the rows of each status', () => {
    expect(countByStatus(rows)).toEqual({ added: 2, changed: 1, unchanged: 1, invalid: 1 })
  })

  it('counts zero for every status of an empty preview', () => {
    expect(countByStatus([])).toEqual({ added: 0, changed: 0, unchanged: 0, invalid: 0 })
  })
})

describe('rowsWithStatus', () => {
  it('keeps every row for all', () => {
    expect(rowsWithStatus(rows, 'all')).toBe(rows)
  })

  it('keeps the rows of one status in CSV order', () => {
    expect(rowsWithStatus(rows, 'added').map(({ line }) => line)).toEqual([2, 6])
  })
})

describe('hasChanges', () => {
  it('is true when the import adds or changes an entry', () => {
    expect(hasChanges({ added: 0, changed: 1, unchanged: 0, invalid: 0 })).toBe(true)
  })

  it('is false when every row is unchanged or invalid', () => {
    expect(hasChanges({ added: 0, changed: 0, unchanged: 3, invalid: 2 })).toBe(false)
  })
})

describe('checkCsv', () => {
  it('accepts CSV text', () => {
    expect(checkCsv('ST;PCE')).toBeNull()
  })

  it.each(['', ' \n\t'])('asks for CSV text instead of %j', (csv) => {
    expect(checkCsv(csv)).toBe('empty')
  })

  it('rejects CSV text above the size limit', () => {
    expect(checkCsv('x'.repeat(maxLookupTableCsvLength))).toBeNull()
    expect(checkCsv('x'.repeat(maxLookupTableCsvLength + 1))).toBe('tooLarge')
  })
})

describe('import reason texts', () => {
  it.each([
    ['en', messagesEn],
    ['de', messagesDe],
  ])('explain every reason code in %s', (_, messages) => {
    const reasons: Readonly<Record<string, string>> = messages.LookupTable.import.reasons

    expect(Object.keys(reasons).toSorted()).toEqual([...lookupTableImportReasons].toSorted())
  })
})
