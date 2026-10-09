import { describe, expect, it } from 'vitest'

import { glnError, normalizeGln } from './gln'

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
