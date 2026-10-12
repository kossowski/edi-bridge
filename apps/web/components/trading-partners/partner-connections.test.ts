import { describe, expect, it } from 'vitest'

import {
  defaultKindKey,
  kindKeysTravelling,
  partnerConnections,
  suggestedName,
} from './partner-connections'

describe('partnerConnections', () => {
  const partner = '10000000-0000-4000-8000-000000000001'
  const other = '10000000-0000-4000-8000-000000000002'

  it('splits the partner’s connections from the shared ones of your systems', () => {
    const channels = [
      { id: 'a', tradingPartnerId: partner },
      { id: 'b', tradingPartnerId: null },
      { id: 'c', tradingPartnerId: other },
      { id: 'd', tradingPartnerId: partner },
    ]

    expect(partnerConnections(channels, partner)).toEqual({
      own: [channels[0], channels[3]],
      shared: [channels[1]],
    })
  })

  it('returns empty lists without connections', () => {
    expect(partnerConnections([], partner)).toEqual({ own: [], shared: [] })
  })
})

describe('kindKeysTravelling', () => {
  it('offers SFTP or a webhook to receive documents', () => {
    expect(kindKeysTravelling('inbound')).toEqual(['sftp-inbound', 'webhook-inbound'])
  })

  it('offers SFTP or HTTP to send documents', () => {
    expect(kindKeysTravelling('outbound')).toEqual(['sftp-outbound', 'http-outbound'])
  })
})

describe('defaultKindKey', () => {
  it.each([
    ['inbound', 'sftp-inbound'],
    ['outbound', 'sftp-outbound'],
  ] as const)('recommends SFTP for %s documents', (direction, key) => {
    expect(defaultKindKey(direction)).toBe(key)
  })
})

describe('suggestedName', () => {
  it('keeps a short name', () => {
    expect(suggestedName('Hansemarkt GmbH SFTP inbox')).toBe('Hansemarkt GmbH SFTP inbox')
  })

  it('clips a name to the 70 characters a connection name may have', () => {
    expect(suggestedName(`${'a'.repeat(69)} SFTP inbox`)).toBe('a'.repeat(69))
  })
})
