import { describe, expect, it } from 'vitest'

import {
  lookupTableEntriesSchema,
  lookupTableInputSchema,
  lookupTablesEndpoint,
} from './lookup-table'

describe('lookupTablesEndpoint', () => {
  it('lists Lookup Tables of the Workspace and of single Trading Partners', () => {
    const tables = [
      {
        id: '00000008-0000-4000-8000-000000000001',
        name: 'Units',
        scope: { kind: 'workspace' },
        entryCount: 4,
        updatedAt: '2026-09-14T08:30:00.000Z',
      },
      {
        id: '00000008-0000-4000-8000-000000000002',
        name: 'Hansemarkt units',
        scope: {
          kind: 'tradingPartner',
          tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
        },
        entryCount: 0,
        updatedAt: '2026-09-15T10:00:00.000Z',
      },
    ]

    expect(lookupTablesEndpoint.response.parse(tables)).toEqual(tables)
  })

  it('rejects a Lookup Table without a scope', () => {
    const table = { id: '00000008-0000-4000-8000-000000000001', name: 'Units' }

    expect(lookupTablesEndpoint.response.safeParse([table]).success).toBe(false)
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
      scope: { kind: 'tradingPartner', tradingPartnerId: '00000001-0000-4000-8000-000000000001' },
      entries: [{ sourceCode: 'ST', targetCode: 'PCE' }],
    }

    expect(lookupTableInputSchema.parse(input)).toEqual({ ...input, name: 'Hansemarkt units' })
  })

  it('rejects an empty name', () => {
    const input = { name: ' ', scope: { kind: 'workspace' }, entries: [] }

    expect(lookupTableInputSchema.safeParse(input).success).toBe(false)
  })
})
