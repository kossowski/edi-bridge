import { describe, expect, it } from 'vitest'

import {
  lookupTableEndpoint,
  lookupTableEntriesSchema,
  lookupTableInputSchema,
  lookupTableMissingCodesEndpoint,
  lookupTableSuggestionsEndpoint,
  lookupTablesEndpoint,
  lookupTableUseSchema,
} from './lookup-table'

const hansemarkt = { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }

const noMissingCodes = { blocking: 0, upcoming: 0 }

describe('lookupTablesEndpoint', () => {
  it('lists Lookup Tables of the Workspace and of single Trading Partners', () => {
    const tables = [
      {
        id: '00000008-0000-4000-8000-000000000001',
        name: 'Units',
        kind: 'units',
        scope: { kind: 'workspace' },
        entryCount: 4,
        uses: [
          {
            mappingId: '00000007-0000-4000-8000-000000000001',
            name: 'ERP JSON to INVOIC',
            messageType: 'INVOIC',
            direction: 'outbound',
            tradingPartners: [hansemarkt],
          },
        ],
        missingCodeCounts: { blocking: 1, upcoming: 2 },
        blockingCodes: ['KRT'],
        updatedAt: '2026-09-14T08:30:00.000Z',
      },
      {
        id: '00000008-0000-4000-8000-000000000002',
        name: 'Hansemarkt units',
        kind: 'units',
        scope: { kind: 'tradingPartner', tradingPartner: hansemarkt },
        entryCount: 0,
        uses: [],
        missingCodeCounts: noMissingCodes,
        blockingCodes: [],
        updatedAt: '2026-09-15T10:00:00.000Z',
      },
    ]

    expect(lookupTablesEndpoint.response.parse(tables)).toEqual(tables)
  })

  it('rejects a kind outside the fixed list', () => {
    const table = {
      id: '00000008-0000-4000-8000-000000000001',
      name: 'Units',
      kind: 'vatCodes',
      scope: { kind: 'workspace' },
      entryCount: 0,
      uses: [],
      missingCodeCounts: noMissingCodes,
      blockingCodes: [],
      updatedAt: '2026-09-14T08:30:00.000Z',
    }

    expect(lookupTablesEndpoint.response.safeParse([table]).success).toBe(false)
  })

  it.each([
    ['fewer', []],
    ['more', ['KRT', 'BTL']],
  ])('rejects %s blocking codes than the blocking count', (_, blockingCodes) => {
    const table = {
      id: '00000008-0000-4000-8000-000000000001',
      name: 'Units',
      kind: 'units',
      scope: { kind: 'workspace' },
      entryCount: 4,
      uses: [],
      missingCodeCounts: { blocking: 1, upcoming: 0 },
      blockingCodes,
      updatedAt: '2026-09-14T08:30:00.000Z',
    }

    expect(lookupTablesEndpoint.response.safeParse([table]).success).toBe(false)
  })

  it('rejects a Lookup Table without a scope', () => {
    const table = { id: '00000008-0000-4000-8000-000000000001', name: 'Units' }

    expect(lookupTablesEndpoint.response.safeParse([table]).success).toBe(false)
  })
})

describe('lookupTableEndpoint', () => {
  it('rejects a blocking count that the blocking codes do not match', () => {
    const table = {
      id: '00000008-0000-4000-8000-000000000001',
      name: 'Units',
      kind: 'units',
      scope: { kind: 'workspace' },
      entryCount: 1,
      uses: [],
      missingCodeCounts: { blocking: 2, upcoming: 0 },
      blockingCodes: ['KRT'],
      updatedAt: '2026-09-14T08:30:00.000Z',
      entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
      codeMeanings: [],
    }

    expect(lookupTableEndpoint.response.safeParse(table).success).toBe(false)
  })
})

describe('lookupTableEntriesSchema', () => {
  it('trims the codes of an entry', () => {
    expect(lookupTableEntriesSchema.parse([{ sourceCode: ' ST ', targetCode: 'PCE ' }])).toEqual([
      { sourceCode: 'ST', targetCode: 'PCE' },
    ])
  })

  it('rejects a repeated source code at the repeated entry', () => {
    const result = lookupTableEntriesSchema.safeParse([
      { sourceCode: 'ST', targetCode: 'PCE' },
      { sourceCode: 'KG', targetCode: 'KGM' },
      { sourceCode: 'ST', targetCode: 'EA' },
    ])

    expect(result.error?.issues.map(({ path }) => path)).toEqual([[2, 'sourceCode']])
  })

  it.each([
    ['source', { sourceCode: ' ', targetCode: 'PCE' }, 'sourceCode'],
    ['target', { sourceCode: 'ST', targetCode: '' }, 'targetCode'],
  ])('rejects an empty %s code', (_, entry, field) => {
    const result = lookupTableEntriesSchema.safeParse([entry])

    expect(result.error?.issues.map(({ path }) => path)).toEqual([[0, field]])
  })
})

describe('lookupTableInputSchema', () => {
  it('scopes a Lookup Table to a Trading Partner by its id', () => {
    const input = {
      name: ' Hansemarkt units ',
      kind: 'units',
      scope: { kind: 'tradingPartner', tradingPartnerId: '00000001-0000-4000-8000-000000000001' },
      entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
    }

    expect(lookupTableInputSchema.parse(input)).toEqual({ ...input, name: 'Hansemarkt units' })
  })

  it('rejects an empty name', () => {
    const input = { name: ' ', kind: 'other', scope: { kind: 'workspace' }, entries: [] }

    expect(lookupTableInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('lookupTableUseSchema', () => {
  const use = {
    mappingId: '00000007-0000-4000-8000-000000000001',
    name: 'ORDERS to ERP JSON',
    messageType: 'ORDERS',
    direction: 'inbound',
    tradingPartners: [hansemarkt],
  }

  it('names the Trading Partners whose Flows run the Mapping', () => {
    expect(lookupTableUseSchema.parse(use)).toEqual(use)
  })

  it('rejects a direction that does not fit the Message Type', () => {
    expect(lookupTableUseSchema.safeParse({ ...use, direction: 'outbound' }).success).toBe(false)
  })
})

describe('lookupTableMissingCodesEndpoint', () => {
  const failedRun = {
    id: '00000000-0000-4000-8000-000000000001',
    receivedAt: '2026-10-10T08:00:00.000Z',
    tradingPartner: hansemarkt,
    messageType: 'INVOIC',
    businessReference: '4711',
  }

  const blocking = {
    urgency: 'blocking',
    code: 'KRT',
    meaning: 'carton',
    suggestions: [{ code: 'CT', meaning: 'Carton' }],
    failedRuns: [failedRun],
  }

  const upcoming = {
    urgency: 'upcoming',
    code: 'BTL',
    meaning: null,
    suggestions: [],
    itemCount: 14,
  }

  it('lists codes that made documents fail and codes that will', () => {
    expect(lookupTableMissingCodesEndpoint.response.parse([blocking, upcoming])).toEqual([
      blocking,
      upcoming,
    ])
  })

  it('rejects a blocking code without the Run it made fail', () => {
    expect(
      lookupTableMissingCodesEndpoint.response.safeParse([{ ...blocking, failedRuns: [] }]).success,
    ).toBe(false)
  })

  it('rejects a code that is listed twice', () => {
    const result = lookupTableMissingCodesEndpoint.response.safeParse([
      blocking,
      { ...upcoming, code: 'KRT' },
    ])

    expect(result.success).toBe(false)
  })
})

describe('lookupTableSuggestionsEndpoint', () => {
  it('asks for a kind and, for one Trading Partner, its id', () => {
    expect(
      lookupTableSuggestionsEndpoint.query.parse({
        kind: 'units',
        tradingPartnerId: hansemarkt.id,
      }),
    ).toEqual({ kind: 'units', tradingPartnerId: hansemarkt.id })
    expect(lookupTableSuggestionsEndpoint.query.parse({ kind: 'countries' })).toEqual({
      kind: 'countries',
    })
  })

  it('rejects a request without a kind', () => {
    expect(lookupTableSuggestionsEndpoint.query.safeParse({}).success).toBe(false)
  })
})
