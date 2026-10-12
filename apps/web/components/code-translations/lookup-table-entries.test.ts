import { describe, expect, it } from 'vitest'

import { maxLookupCodeLength } from '@edi-bridge/contracts'

import type { FailedRunReference, LookupTableUse, MissingCode } from '@edi-bridge/contracts'

import {
  fixesOf,
  hasValue,
  matchesFilter,
  problemsOf,
  restoredEntry,
  runsToReprocess,
  tableDirection,
  trimmedEntry,
  withEntry,
  withFixes,
  withoutEntry,
} from './lookup-table-entries'

const entries = [
  { sourceCode: 'ST', targetCode: 'PCE' },
  { sourceCode: 'KG', targetCode: 'KGM' },
  { sourceCode: 'L', targetCode: 'LTR' },
]

describe('problemsOf', () => {
  it('accepts a new value with both codes', () => {
    expect(problemsOf(entries, { sourceCode: ' KRT ', targetCode: 'CT' }, null)).toBeNull()
  })

  it('asks for both codes', () => {
    expect(problemsOf(entries, { sourceCode: ' ', targetCode: '' }, null)).toEqual({
      sourceCode: 'required',
      targetCode: 'required',
    })
  })

  it('rejects codes longer than the contract allows', () => {
    const long = 'X'.repeat(maxLookupCodeLength + 1)

    expect(problemsOf(entries, { sourceCode: long, targetCode: long }, null)).toEqual({
      sourceCode: 'tooLong',
      targetCode: 'tooLong',
    })
  })

  it('rejects a value that already has a translation', () => {
    expect(problemsOf(entries, { sourceCode: 'KG ', targetCode: 'KGS' }, null)).toEqual({
      sourceCode: 'duplicate',
      targetCode: null,
    })
  })

  it('lets an edited value keep its own code', () => {
    expect(problemsOf(entries, { sourceCode: 'KG', targetCode: 'KGS' }, 1)).toBeNull()
    expect(problemsOf(entries, { sourceCode: 'ST', targetCode: 'KGS' }, 1)?.sourceCode).toBe(
      'duplicate',
    )
  })
})

describe('entry changes', () => {
  it('trims both codes', () => {
    expect(trimmedEntry({ sourceCode: ' KRT', targetCode: 'CT ' })).toEqual({
      sourceCode: 'KRT',
      targetCode: 'CT',
    })
  })

  it('appends a new value and replaces an edited one', () => {
    const krt = { sourceCode: 'KRT', targetCode: 'CT' }

    expect(withEntry(entries, krt, null)).toEqual([...entries, krt])
    expect(withEntry(entries, krt, 1)).toEqual([entries[0], krt, entries[2]])
  })

  it('restores a removed value at its old position', () => {
    const removed = withoutEntry(entries, 1)

    expect(removed).toEqual([entries[0], entries[2]])
    expect(restoredEntry(removed, entries[1]!, 1)).toEqual(entries)
    expect(restoredEntry([], entries[1]!, 4)).toEqual([entries[1]])
  })

  it('finds values by their own code', () => {
    expect(hasValue(entries, 'KG')).toBe(true)
    expect(hasValue(entries, 'KGM')).toBe(false)
  })

  it('filters by either code', () => {
    expect(entries.filter((entry) => matchesFilter(entry, 'kg'))).toEqual([entries[1]])
    expect(entries.filter((entry) => matchesFilter(entry, 'ltr'))).toEqual([entries[2]])
    expect(entries.filter((entry) => matchesFilter(entry, ''))).toEqual(entries)
  })
})

function failedRun(id: string, receivedAt: string): FailedRunReference {
  return {
    id,
    receivedAt,
    tradingPartner: { id: 'p-1', name: 'Hansemarkt' },
    messageType: 'ORDERS',
    businessReference: null,
  }
}

const older = failedRun('r-old', '2026-03-01T08:00:00.000Z')

const newer = failedRun('r-new', '2026-03-02T08:00:00.000Z')

const newest = failedRun('r-newest', '2026-03-03T08:00:00.000Z')

const missingCodes: MissingCode[] = [
  { urgency: 'blocking', code: 'KRT', meaning: null, suggestions: [], failedRuns: [older, newer] },
  { urgency: 'blocking', code: 'DOS', meaning: null, suggestions: [], failedRuns: [newest] },
  { urgency: 'upcoming', code: 'BTL', meaning: null, suggestions: [], itemCount: 3 },
]

describe('fixes', () => {
  it('names the blocking codes a save translates', () => {
    const saved = [
      ...entries,
      { sourceCode: 'KRT', targetCode: 'CT' },
      { sourceCode: 'BTL', targetCode: 'BO' },
    ]

    expect(fixesOf(missingCodes, saved)).toEqual([
      { code: 'KRT', targetCode: 'CT', failedRuns: [older, newer] },
    ])
    expect(fixesOf(missingCodes, entries)).toEqual([])
  })

  it('replaces an earlier fix of the same code', () => {
    const krt = { code: 'KRT', targetCode: 'CT', failedRuns: [older] }
    const dos = { code: 'DOS', targetCode: 'PCE', failedRuns: [newest] }

    expect(withFixes([krt, dos], [{ ...krt, targetCode: 'PK' }])).toEqual([
      dos,
      { ...krt, targetCode: 'PK' },
    ])
  })

  it('puts the origin Run first, then the newest, each once', () => {
    const fixes = [
      { code: 'KRT', targetCode: 'CT', failedRuns: [older, newer] },
      { code: 'DOS', targetCode: 'PCE', failedRuns: [newest, newer] },
    ]

    expect(runsToReprocess(fixes, undefined)).toEqual([newest, newer, older])
    expect(runsToReprocess(fixes, older.id)).toEqual([older, newest, newer])
  })
})

describe('tableDirection', () => {
  const use = (direction: LookupTableUse['direction']): LookupTableUse => ({
    mappingId: 'm-1',
    name: 'Orders',
    messageType: direction === 'inbound' ? 'ORDERS' : 'INVOIC',
    direction,
    tradingPartners: [],
  })

  it('reads a list as incoming once any Mapping reads it inbound', () => {
    expect(tableDirection([use('outbound'), use('inbound')])).toBe('inbound')
    expect(tableDirection([use('outbound')])).toBe('outbound')
    expect(tableDirection([])).toBe('outbound')
  })
})
