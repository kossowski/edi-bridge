import { describe, expect, it } from 'vitest'

import { matchesFilter, sameEntries, toRows, validateEntries } from './lookup-table-entries'

describe('validateEntries', () => {
  it('returns the trimmed entries when every row is valid', () => {
    expect(
      validateEntries([
        { sourceCode: ' ST ', targetCode: 'PCE' },
        { sourceCode: 'KG', targetCode: ' KGM' },
      ]),
    ).toEqual({
      entries: [
        { sourceCode: 'ST', targetCode: 'PCE' },
        { sourceCode: 'KG', targetCode: 'KGM' },
      ],
    })
  })

  it('accepts an empty table', () => {
    expect(validateEntries([])).toEqual({ entries: [] })
  })

  it('asks for both codes', () => {
    expect(
      validateEntries([
        { sourceCode: 'ST', targetCode: 'PCE' },
        { sourceCode: '  ', targetCode: '' },
      ]),
    ).toEqual({
      errors: new Map([
        [1, { sourceCode: { kind: 'required' }, targetCode: { kind: 'required' } }],
      ]),
    })
  })

  it('rejects codes longer than 70 characters', () => {
    expect(validateEntries([{ sourceCode: 'ST', targetCode: 'x'.repeat(71) }])).toEqual({
      errors: new Map([[0, { targetCode: { kind: 'tooLong', max: 70 } }]]),
    })
  })

  it('points a repeated source code to the row that uses it first', () => {
    expect(
      validateEntries([
        { sourceCode: 'ST', targetCode: 'PCE' },
        { sourceCode: 'KG', targetCode: 'KGM' },
        { sourceCode: 'ST ', targetCode: 'PCS' },
        { sourceCode: 'ST', targetCode: 'PCX' },
      ]),
    ).toEqual({
      errors: new Map([
        [2, { sourceCode: { kind: 'duplicate', row: 1 } }],
        [3, { sourceCode: { kind: 'duplicate', row: 1 } }],
      ]),
    })
  })
})

describe('sameEntries', () => {
  const saved = [{ sourceCode: 'ST', targetCode: 'PCE' }]

  it('compares the codes of rows with the saved entries', () => {
    expect(sameEntries(toRows(saved), saved)).toBe(true)
    expect(sameEntries([{ sourceCode: 'ST', targetCode: 'PCS' }], saved)).toBe(false)
    expect(sameEntries([], saved)).toBe(false)
  })
})

describe('toRows', () => {
  it('gives each entry a key from the first key on', () => {
    expect(toRows([{ sourceCode: 'ST', targetCode: 'PCE' }], 5)).toEqual([
      { key: 5, sourceCode: 'ST', targetCode: 'PCE' },
    ])
  })
})

describe('matchesFilter', () => {
  it('finds a lower-case term in either code', () => {
    const row = { sourceCode: 'Deutschland', targetCode: 'DE' }

    expect(matchesFilter(row, 'deutsch')).toBe(true)
    expect(matchesFilter(row, 'de')).toBe(true)
    expect(matchesFilter(row, 'at')).toBe(false)
    expect(matchesFilter(row, '')).toBe(true)
  })
})
