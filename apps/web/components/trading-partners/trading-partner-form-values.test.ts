import { describe, expect, it } from 'vitest'

import { createTradingPartner } from '@edi-bridge/mocks'

import { glnError, toFormValues, validateTradingPartnerForm } from './trading-partner-form-values'

const valid = {
  name: 'Kieler Kontor GmbH',
  gln: '0234567890129',
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: '12',
} as const

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

describe('validateTradingPartnerForm', () => {
  it('turns valid values into the API input', () => {
    expect(validateTradingPartnerForm({ ...valid, name: '  Kieler Kontor GmbH ' })).toEqual({
      input: {
        name: 'Kieler Kontor GmbH',
        gln: '0234567890129',
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 12,
      },
    })
  })

  it('removes spaces from the GLN', () => {
    expect(validateTradingPartnerForm({ ...valid, gln: '0234 5678 90129' })).toMatchObject({
      input: { gln: '0234567890129' },
    })
  })

  it('reports every invalid field at once', () => {
    expect(
      validateTradingPartnerForm({
        ...valid,
        name: ' ',
        gln: '0234567890128',
        acknowledgementTimeLimitHours: '0',
      }),
    ).toEqual({
      errors: { name: 'required', gln: 'checkDigit', acknowledgementTimeLimitHours: 'range' },
    })
  })

  it.each(['169', '1.5', 'abc', ''])(
    'rejects %j as an Acknowledgement time limit',
    (acknowledgementTimeLimitHours) => {
      expect(validateTradingPartnerForm({ ...valid, acknowledgementTimeLimitHours })).toEqual({
        errors: { acknowledgementTimeLimitHours: 'range' },
      })
    },
  )

  it.each(['1', '168'])('accepts the boundary %s hours', (acknowledgementTimeLimitHours) => {
    expect(validateTradingPartnerForm({ ...valid, acknowledgementTimeLimitHours })).toHaveProperty(
      'input',
    )
  })

  it('rejects a name longer than 70 characters', () => {
    expect(validateTradingPartnerForm({ ...valid, name: 'x'.repeat(71) })).toEqual({
      errors: { name: 'tooLong' },
    })
  })
})

describe('toFormValues', () => {
  it('starts a new Trading Partner with UNOC and 24 hours', () => {
    expect(toFormValues()).toEqual({
      name: '',
      gln: '',
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: '24',
    })
  })

  it('fills the form from an existing Trading Partner', () => {
    const tradingPartner = createTradingPartner({ ...valid, acknowledgementTimeLimitHours: 12 })

    expect(validateTradingPartnerForm(toFormValues(tradingPartner))).toEqual({
      input: { ...valid, acknowledgementTimeLimitHours: 12 },
    })
  })
})
