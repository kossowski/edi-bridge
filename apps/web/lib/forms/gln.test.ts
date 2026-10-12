import { describe, expect, it } from 'vitest'

import { glnError, isTakenGln, normalizeGln } from './gln'

describe('glnError', () => {
  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['023456789012', 'format'],
    ['0234567890128', 'checkDigit'],
  ])('reports %j as %s', (value, expected) => {
    expect(glnError(value)).toBe(expected)
  })

  it('accepts a GLN typed in groups with spaces', () => {
    expect(glnError('023 4567 890129')).toBeNull()
  })
})

describe('normalizeGln', () => {
  it('removes the spaces between digit groups', () => {
    expect(normalizeGln(' 0234 5678 90129 ')).toBe('0234567890129')
  })
})

describe('isTakenGln', () => {
  const taken = '0234567890129'

  it('matches the taken GLN however it is spaced', () => {
    expect(isTakenGln('0234 5678 90129', taken)).toBe(true)
  })

  it('clears once the GLN changes or none is taken', () => {
    expect(isTakenGln('4012345000009', taken)).toBe(false)
    expect(isTakenGln(null, taken)).toBe(false)
    expect(isTakenGln(taken, null)).toBe(false)
  })
})
