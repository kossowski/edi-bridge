import { describe, expect, it } from 'vitest'

import { limitCodes, parseFormat } from './row-meaning'

describe('parseFormat', () => {
  it('reads a variable alphanumeric format', () => {
    expect(parseFormat('an..35')).toEqual({ characters: 'an', variable: true, length: 35 })
  })

  it('reads a fixed numeric format', () => {
    expect(parseFormat('n6')).toEqual({ characters: 'n', variable: false, length: 6 })
  })

  it('reads an alphabetic format', () => {
    expect(parseFormat('a..3')).toEqual({ characters: 'a', variable: true, length: 3 })
  })

  it('rejects anything else', () => {
    expect(parseFormat('string')).toBeNull()
  })
})

describe('limitCodes', () => {
  const codes = Array.from({ length: 8 }, (_, index) => ({
    code: String(index),
    meaning: `Meaning ${index}`,
  }))

  it('keeps a short list whole', () => {
    expect(limitCodes(codes.slice(0, 3), 5)).toEqual({ shown: codes.slice(0, 3), hidden: 0 })
  })

  it('cuts a long list and counts the rest', () => {
    expect(limitCodes(codes, 5)).toEqual({ shown: codes.slice(0, 5), hidden: 3 })
  })

  it('shows one code over the limit instead of hiding it', () => {
    expect(limitCodes(codes.slice(0, 6), 5)).toEqual({ shown: codes.slice(0, 6), hidden: 0 })
  })
})
