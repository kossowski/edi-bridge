import { describe, expect, it } from 'vitest'

import { seedTradingPartners } from '@edi-bridge/mocks'

import { toFormValues, validateLookupTableForm } from './lookup-table-form-values'

const hansemarkt = seedTradingPartners[0]!

describe('validateLookupTableForm', () => {
  it('turns a Workspace table into the API settings', () => {
    expect(
      validateLookupTableForm({
        name: '  Units of measure ',
        scopeKind: 'workspace',
        tradingPartnerId: hansemarkt.id,
      }),
    ).toEqual({ input: { name: 'Units of measure', scope: { kind: 'workspace' } } })
  })

  it('scopes the table to the chosen Trading Partner', () => {
    expect(
      validateLookupTableForm({
        name: 'Units',
        scopeKind: 'tradingPartner',
        tradingPartnerId: hansemarkt.id,
      }),
    ).toEqual({
      input: { name: 'Units', scope: { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id } },
    })
  })

  it('asks for a name and a Trading Partner', () => {
    expect(
      validateLookupTableForm({ name: ' ', scopeKind: 'tradingPartner', tradingPartnerId: null }),
    ).toEqual({ errors: { name: 'required', tradingPartnerId: 'required' } })
  })

  it('rejects a name longer than 70 characters', () => {
    expect(
      validateLookupTableForm({
        name: 'x'.repeat(71),
        scopeKind: 'workspace',
        tradingPartnerId: null,
      }),
    ).toEqual({ errors: { name: 'tooLong' } })
  })
})

describe('toFormValues', () => {
  it('takes the Trading Partner of a scoped table', () => {
    expect(
      toFormValues({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Units',
        kind: 'units',
        scope: {
          kind: 'tradingPartner',
          tradingPartner: { id: hansemarkt.id, name: 'Hansemarkt' },
        },
        entryCount: 2,
        uses: [],
        missingCodeCounts: { blocking: 0, upcoming: 0 },
        blockingCodes: [],
        updatedAt: '2026-10-01T08:00:00.000Z',
      }),
    ).toEqual({ name: 'Units', scopeKind: 'tradingPartner', tradingPartnerId: hansemarkt.id })
  })
})
