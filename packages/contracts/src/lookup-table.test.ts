import { describe, expect, it } from 'vitest'

import { lookupTablesEndpoint } from './lookup-table'

describe('lookupTablesEndpoint', () => {
  it('lists Lookup Tables of the Workspace and of single Trading Partners', () => {
    const tables = [
      { id: '00000008-0000-4000-8000-000000000001', name: 'Units', scope: { kind: 'workspace' } },
      {
        id: '00000008-0000-4000-8000-000000000002',
        name: 'Hansemarkt units',
        scope: {
          kind: 'tradingPartner',
          tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
        },
      },
    ]

    expect(lookupTablesEndpoint.response.parse(tables)).toEqual(tables)
  })

  it('rejects a Lookup Table without a scope', () => {
    const table = { id: '00000008-0000-4000-8000-000000000001', name: 'Units' }

    expect(lookupTablesEndpoint.response.safeParse([table]).success).toBe(false)
  })
})
