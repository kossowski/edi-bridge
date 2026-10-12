import { describe, expect, it } from 'vitest'

import { maxLookupCodeLength } from '@edi-bridge/contracts'

import {
  hasValue,
  matchesFilter,
  problemsOf,
  restoredEntry,
  trimmedEntry,
  withEntry,
  withoutEntry,
} from './phrasebook-entries'

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
