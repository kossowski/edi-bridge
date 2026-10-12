import { describe, expect, it } from 'vitest'

import { toFormValues } from '../channels/channel-form-values'
import {
  channelFieldErrors,
  chooseMapping,
  chooseWay,
  connectionFields,
  firstInvalidField,
  initialWizardState,
  neededDirections,
  type PartnerWizardState,
  postponedDirections,
  stepErrors,
  toggleDocument,
  wizardFieldId,
  wizardResult,
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

  it.each(wizardSteps.slice(3))('has nothing to check on the %s step yet', (step) => {
    expect(stepErrors(step, initialWizardState)).toEqual({})
  })
})

const sftpInbound = {
  ...chooseWay(undefined, 'inbound', 'sftp').values,
  host: 'sftp.kieler-kontor.de',
  username: 'edi',
  remotePath: '/out',
  credential: 'secret',
}

function withConnections(
  documents: PartnerWizardState['documents'],
  connections: PartnerWizardState['connections'],
): PartnerWizardState {
  return { ...withPartner(validPartner), documents, connections }
}

describe('connections step', () => {
  it('asks for a way for each direction the documents need', () => {
    expect(stepErrors('connections', withConnections(['ORDERS', 'INVOIC'], {}))).toEqual({
      'inbound.way': 'required',
      'outbound.way': 'required',
    })
  })

  it('ignores a direction no document needs', () => {
    expect(
      stepErrors(
        'connections',
        withConnections(['ORDERS'], { inbound: { way: 'ask', values: sftpInbound } }),
      ),
    ).toEqual({})
  })

  it('accepts complete SFTP details and an inbound web address without details', () => {
    expect(
      stepErrors(
        'connections',
        withConnections(['ORDERS'], { inbound: { way: 'sftp', values: sftpInbound } }),
      ),
    ).toEqual({})
    expect(
      stepErrors(
        'connections',
        withConnections(['ORDERS'], { inbound: chooseWay(undefined, 'inbound', 'web') }),
      ),
    ).toEqual({})
  })

  it('reports the missing SFTP details in the order of the form', () => {
    const errors = stepErrors(
      'connections',
      withConnections(['DESADV'], { outbound: chooseWay(undefined, 'outbound', 'sftp') }),
    )

    expect(errors).toEqual({
      'outbound.host': 'required',
      'outbound.username': 'required',
      'outbound.credential': 'required',
    })
    expect(firstInvalidField(errors)).toBe('outbound.host')
    expect(channelFieldErrors(errors, 'outbound')).toEqual({
      host: 'required',
      username: 'required',
      credential: 'required',
    })
    expect(channelFieldErrors(errors, 'inbound')).toEqual({})
  })

  it('checks the partner web address and asks for the authorization only when it is sent', () => {
    const http = chooseWay(undefined, 'outbound', 'web')

    expect(stepErrors('connections', withConnections(['INVOIC'], { outbound: http }))).toEqual({
      'outbound.url': 'required',
    })
    expect(
      stepErrors(
        'connections',
        withConnections(['INVOIC'], {
          outbound: {
            ...http,
            values: { ...http.values, url: 'ftp://kieler', sendAuthorization: true },
          },
        }),
      ),
    ).toEqual({ 'outbound.url': 'format', 'outbound.authorization': 'required' })
  })

  it('needs no details for a direction asked of the partner', () => {
    expect(
      stepErrors(
        'connections',
        withConnections(['ORDERS', 'DESADV'], {
          inbound: chooseWay(undefined, 'inbound', 'ask'),
          outbound: chooseWay(undefined, 'outbound', 'ask'),
        }),
      ),
    ).toEqual({})
  })

  it('finds the first invalid field across both directions', () => {
    expect(
      firstInvalidField(
        stepErrors(
          'connections',
          withConnections(['ORDERS', 'DESADV'], {
            outbound: chooseWay(undefined, 'outbound', 'ask'),
          }),
        ),
      ),
    ).toBe('inbound.way')
  })
})

describe('chooseWay', () => {
  it('starts with the defaults and no Authorization header', () => {
    expect(chooseWay(undefined, 'outbound', 'web')).toEqual({
      way: 'web',
      values: { ...toFormValues(), kind: 'http-outbound', sendAuthorization: false },
    })
  })

  it('keeps the typed details when the way changes', () => {
    const asked = chooseWay({ way: 'sftp', values: sftpInbound }, 'inbound', 'ask')

    expect(asked).toEqual({ way: 'ask', values: sftpInbound })
    expect(chooseWay(asked, 'inbound', 'web').values).toEqual({
      ...sftpInbound,
      kind: 'webhook-inbound',
    })
  })
})

describe('postponedDirections', () => {
  it('lists the needed directions asked of the partner', () => {
    const connections = {
      inbound: chooseWay(undefined, 'inbound', 'ask'),
      outbound: chooseWay(undefined, 'outbound', 'ask'),
    }

    expect(postponedDirections(withConnections(['INVOIC'], connections))).toEqual(['outbound'])
    expect(postponedDirections(withConnections(['ORDERS', 'INVOIC'], connections))).toEqual([
      'inbound',
      'outbound',
    ])
  })
})

describe('firstInvalidField', () => {
  it('finds the first invalid field in the order of the step', () => {
    expect(firstInvalidField(stepErrors('partner', initialWizardState))).toBe('name')
    expect(firstInvalidField(stepErrors('partner', withPartner({ name: 'Kieler Kontor' })))).toBe(
      'gln',
    )
    expect(firstInvalidField(stepErrors('documents', initialWizardState))).toBe('documents')
  })

  it('finds nothing on a valid step', () => {
    expect(firstInvalidField(stepErrors('partner', withPartner(validPartner)))).toBeUndefined()
  })
})

describe('wizardResult', () => {
  it('hands on the trimmed name and the GLN without spaces', () => {
    expect(
      wizardResult(withPartner({ name: ' Kieler Kontor GmbH ', gln: '0234 5678 90129' })).partner,
    ).toEqual({ name: 'Kieler Kontor GmbH', gln: '0234567890129' })
  })

  it('hands on no GLN when it is added later, though the step keeps the typed one', () => {
    const state = withPartner({ ...validPartner, glnLater: true })

    expect(wizardResult(state).partner).toEqual({ name: validPartner.name, gln: null })
    expect(state.partner.gln).toBe(validPartner.gln)
  })
})

describe('wizardResult connections', () => {
  it('hands on only the connections the chosen documents need', () => {
    const inbound = { way: 'sftp', values: sftpInbound } as const
    const outbound = chooseWay(undefined, 'outbound', 'ask')

    expect(wizardResult(withConnections(['ORDERS'], { inbound, outbound })).connections).toEqual({
      inbound,
    })
  })

  it('hands on no connection details for a direction asked of the partner', () => {
    const inbound = { way: 'ask', values: sftpInbound } as const
    const outbound = chooseWay(undefined, 'outbound', 'web')

    expect(
      wizardResult(withConnections(['ORDERS', 'INVOIC'], { inbound, outbound })).connections,
    ).toEqual({ inbound: { way: 'ask' }, outbound })
  })
})

describe('connectionFields', () => {
  it('leaves out the name and the trading partner the wizard sets itself', () => {
    expect(connectionFields).not.toContain('name')
    expect(connectionFields).not.toContain('tradingPartnerId')
    expect(connectionFields).toContain('host')
  })
})

describe('wizardFieldId', () => {
  it('builds the id of a connection field under the id of its direction', () => {
    expect(wizardFieldId('wizard', 'name')).toBe('wizard-name')
    expect(wizardFieldId('wizard', 'outbound.way')).toBe('wizard-outbound-way')
    expect(wizardFieldId('wizard', 'inbound.host')).toBe(
      `${wizardFieldId('wizard', 'inbound')}-host`,
    )
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

describe('mappings step', () => {
  function withMappings(mappings: PartnerWizardState['mappings']): PartnerWizardState {
    return { ...initialWizardState, documents: ['ORDERS', 'INVOIC'], mappings }
  }

  it('asks for a choice for each chosen document, in document order', () => {
    const errors = stepErrors('mappings', withMappings({ INVOIC: { way: 'later' } }))

    expect(errors).toEqual({ 'ORDERS.mapping': 'required' })
    expect(firstInvalidField(stepErrors('mappings', withMappings({})))).toBe('ORDERS.mapping')
  })

  it('asks which mapping when an existing one is chosen without picking it', () => {
    expect(
      stepErrors(
        'mappings',
        withMappings({
          ORDERS: { way: 'existing', mappingVersionId: null },
          INVOIC: { way: 'ai' },
        }),
      ),
    ).toEqual({ 'ORDERS.mappingVersion': 'required' })
  })

  it('accepts an existing mapping, an AI draft or later', () => {
    expect(
      stepErrors(
        'mappings',
        withMappings({
          ORDERS: { way: 'existing', mappingVersionId: 'v1' },
          INVOIC: { way: 'ai' },
        }),
      ),
    ).toEqual({})
  })
})

describe('chooseMapping', () => {
  it('picks the only existing mapping', () => {
    expect(chooseMapping(undefined, 'existing', ['v1'])).toEqual({
      way: 'existing',
      mappingVersionId: 'v1',
    })
  })

  it('waits for a pick among several, and keeps an earlier pick', () => {
    expect(chooseMapping(undefined, 'existing', ['v1', 'v2'])).toEqual({
      way: 'existing',
      mappingVersionId: null,
    })
    expect(
      chooseMapping({ way: 'existing', mappingVersionId: 'v2' }, 'existing', ['v1', 'v2']),
    ).toEqual({ way: 'existing', mappingVersionId: 'v2' })
  })

  it('drops the pick for an AI draft or later', () => {
    expect(chooseMapping({ way: 'existing', mappingVersionId: 'v1' }, 'ai', ['v1'])).toEqual({
      way: 'ai',
    })
    expect(chooseMapping(undefined, 'later', [])).toEqual({ way: 'later' })
  })
})

describe('wizardResult mappings', () => {
  it('hands on the mappings of the chosen documents only', () => {
    const state: PartnerWizardState = {
      ...initialWizardState,
      documents: ['ORDERS'],
      mappings: {
        ORDERS: { way: 'existing', mappingVersionId: 'v1' },
        INVOIC: { way: 'ai' },
      },
    }

    expect(wizardResult(state).mappings).toEqual({
      ORDERS: { way: 'existing', mappingVersionId: 'v1' },
    })
  })
})
