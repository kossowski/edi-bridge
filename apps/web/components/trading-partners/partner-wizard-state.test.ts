import { describe, expect, it } from 'vitest'

import {
  initialWizardState,
  neededDirections,
  type PartnerWizardState,
  stepErrors,
  toggleDocument,
  wizardSteps,
} from './partner-wizard-state'

function withPartner(partner: Partial<PartnerWizardState['partner']>): PartnerWizardState {
  return { ...initialWizardState, partner: { ...initialWizardState.partner, ...partner } }
}

const validPartner = { name: 'Kieler Kontor GmbH', gln: '0234567890129' }

describe('stepErrors', () => {
  it('accepts a partner with a name and a valid GLN', () => {
    expect(stepErrors('partner', withPartner(validPartner))).toEqual({})
  })

  it('asks for a name and a GLN on an empty partner step', () => {
    expect(stepErrors('partner', initialWizardState)).toEqual({
      name: 'required',
      gln: 'required',
    })
  })

  it.each([
    ['   ', 'required'],
    ['x'.repeat(71), 'tooLong'],
  ])('reports the name %j as %s', (name, expected) => {
    expect(stepErrors('partner', withPartner({ ...validPartner, name }))).toEqual({
      name: expected,
    })
  })

  it.each([
    ['023456789012', 'format'],
    ['0234567890128', 'checkDigit'],
  ])('reports the GLN %j as %s', (gln, expected) => {
    expect(stepErrors('partner', withPartner({ ...validPartner, gln }))).toEqual({
      gln: expected,
    })
  })

  it('accepts a GLN typed in groups with spaces', () => {
    expect(stepErrors('partner', withPartner({ ...validPartner, gln: '0234 5678 90129' }))).toEqual(
      {},
    )
  })

  it.each(['', '123'])('ignores the GLN %j when it is added later', (gln) => {
    expect(
      stepErrors('partner', withPartner({ name: validPartner.name, gln, glnLater: true })),
    ).toEqual({})
  })

  it('asks for at least one document', () => {
    expect(stepErrors('documents', initialWizardState)).toEqual({ documents: 'required' })
    expect(stepErrors('documents', { ...initialWizardState, documents: ['INVOIC'] })).toEqual({})
  })

  it.each(wizardSteps.slice(2))('has nothing to check on the %s step yet', (step) => {
    expect(stepErrors(step, initialWizardState)).toEqual({})
  })
})

describe('toggleDocument', () => {
  it('keeps the documents in the order of the step', () => {
    expect(toggleDocument(['INVOIC'], 'ORDERS', true)).toEqual(['ORDERS', 'INVOIC'])
  })

  it('removes a document', () => {
    expect(toggleDocument(['ORDERS', 'DESADV'], 'ORDERS', false)).toEqual(['DESADV'])
  })
})

describe('neededDirections', () => {
  it.each([
    [[], []],
    [['ORDERS'], ['inbound']],
    [['DESADV', 'INVOIC'], ['outbound']],
    [
      ['INVOIC', 'ORDERS'],
      ['inbound', 'outbound'],
    ],
  ] as const)('the documents %j need the directions %j', (documents, expected) => {
    expect(neededDirections(documents)).toEqual(expected)
  })
})
