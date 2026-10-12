import { describe, expect, it } from 'vitest'

import { seedTradingPartners } from '@edi-bridge/mocks'

import type { LookupTableSummary } from '@edi-bridge/contracts'

import { namesFor, uniqueListName } from './new-list-name'

const hansemarkt = seedTradingPartners[0]!

describe('uniqueListName', () => {
  it('keeps a name nobody uses', () => {
    expect(uniqueListName('Units of measure', ['Country codes'])).toBe('Units of measure')
  })

  it('numbers a name that is taken, ignoring case', () => {
    expect(uniqueListName('Units of measure', ['units of measure', 'Units of measure (2)'])).toBe(
      'Units of measure (3)',
    )
  })

  it('tells accented names apart like the API', () => {
    expect(uniqueListName('Länder', ['Lander'])).toBe('Länder')
  })

  it('shortens a long name to the 70 characters a name may have', () => {
    const base = `Units of measure for ${'Hansemarkt '.repeat(6)}GmbH`
    const first = uniqueListName(base, [])
    const second = uniqueListName(base, [first])

    expect(first.length).toBeLessThanOrEqual(70)
    expect(first.endsWith('…')).toBe(true)
    expect(second.length).toBeLessThanOrEqual(70)
    expect(second.endsWith('… (2)')).toBe(true)
  })
})

describe('namesFor', () => {
  const tables: Array<Pick<LookupTableSummary, 'name' | 'scope'>> = [
    { name: 'Units of measure', scope: { kind: 'workspace' } },
    {
      name: 'Hansemarkt units',
      scope: {
        kind: 'tradingPartner',
        tradingPartner: { id: hansemarkt.id, name: hansemarkt.name },
      },
    },
  ]

  it('lists the names sent to every partner', () => {
    expect(namesFor(tables, { kind: 'workspace' })).toEqual(['Units of measure'])
  })

  it('lists the names of one Trading Partner', () => {
    expect(namesFor(tables, { kind: 'tradingPartner', tradingPartnerId: hansemarkt.id })).toEqual([
      'Hansemarkt units',
    ])
  })
})
