import { describe, expect, it } from 'vitest'

import { codeMeaningOf, codeMeaningsOf, languageQuerySchema } from './code-meaning'

describe('codeMeaningOf', () => {
  it.each([
    ['en', 'Piece'],
    ['de', 'Stück'],
  ] as const)('names a UN/ECE unit code in %s', (language, meaning) => {
    expect(codeMeaningOf('units', 'PCE', language)).toBe(meaning)
  })

  it.each([
    ['en', 'Netherlands'],
    ['de', 'Niederlande'],
  ] as const)('names an ISO 3166 country code in %s', (language, meaning) => {
    expect(codeMeaningOf('countries', 'NL', language)).toBe(meaning)
  })

  it.each(['EU', 'ZZ', 'XX', 'nl', 'DEU'])('knows no country %s', (code) => {
    expect(codeMeaningOf('countries', code, 'en')).toBeNull()
  })

  it('knows no meaning for an unknown unit or a kind without a code list', () => {
    expect(codeMeaningOf('units', 'KRT', 'en')).toBeNull()
    expect(codeMeaningOf('addresses', 'DE', 'en')).toBeNull()
    expect(codeMeaningOf('other', 'PCE', 'en')).toBeNull()
  })
})

describe('codeMeaningsOf', () => {
  it('explains each known code once, in the order given', () => {
    expect(codeMeaningsOf('units', ['KGM', 'KRT', 'PCE', 'KGM'], 'de')).toEqual([
      { code: 'KGM', meaning: 'Kilogramm' },
      { code: 'PCE', meaning: 'Stück' },
    ])
  })
})

describe('languageQuerySchema', () => {
  it('reads English when no language is given', () => {
    expect(languageQuerySchema.parse({})).toEqual({ language: 'en' })
  })

  it('rejects a language the pages do not speak', () => {
    expect(languageQuerySchema.safeParse({ language: 'fr' }).success).toBe(false)
  })
})
