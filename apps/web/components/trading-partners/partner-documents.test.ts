import { describe, expect, it } from 'vitest'

import {
  chosenOrOnly,
  documentConnections,
  latestMappingVersions,
  newDocumentFlow,
  newestVersion,
  partnerDocuments,
} from './partner-documents'

const partner = '10000000-0000-4000-8000-000000000001'

const other = '10000000-0000-4000-8000-000000000002'

function version(mappingId: string, number: number, mappingName = `Mapping ${mappingId}`) {
  return {
    id: `${mappingId}-${number}`,
    mappingId,
    mappingName,
    version: number,
    publishedAt: '2026-03-02T09:00:00.000Z',
  }
}

describe('partnerDocuments', () => {
  it('keeps the partner’s Flows in Message Type order, then by name', () => {
    const flows = [
      { id: '1', name: 'Invoices', messageType: 'INVOIC', tradingPartnerId: partner },
      { id: '2', name: 'Orders B', messageType: 'ORDERS', tradingPartnerId: partner },
      { id: '3', name: 'Orders', messageType: 'ORDERS', tradingPartnerId: other },
      { id: '4', name: 'Orders A', messageType: 'ORDERS', tradingPartnerId: partner },
      { id: '5', name: 'Dispatch', messageType: 'DESADV', tradingPartnerId: partner },
    ] as const

    expect(partnerDocuments(flows, partner).map(({ id }) => id)).toEqual(['4', '2', '5', '1'])
  })

  it('returns nothing for a partner without Flows', () => {
    expect(partnerDocuments([], partner)).toEqual([])
  })
})

describe('documentConnections', () => {
  const channels = [
    { id: 'in-b', name: 'B inbox', direction: 'inbound', tradingPartnerId: partner },
    { id: 'in-a', name: 'A inbox', direction: 'inbound', tradingPartnerId: partner },
    { id: 'out', name: 'Outbox', direction: 'outbound', tradingPartnerId: partner },
    { id: 'erp-in', name: 'ERP webhook', direction: 'inbound', tradingPartnerId: null },
    { id: 'erp-out', name: 'ERP delivery', direction: 'outbound', tradingPartnerId: null },
    { id: 'other', name: 'Other inbox', direction: 'inbound', tradingPartnerId: other },
  ] as const

  function ids(messageType: 'ORDERS' | 'INVOIC') {
    const connections = documentConnections(channels, messageType, partner)

    return {
      partner: connections.partner.map(({ id }) => id),
      own: connections.own.map(({ id }) => id),
    }
  }

  it('receives documents from the partner and hands them to your systems', () => {
    expect(ids('ORDERS')).toEqual({
      partner: ['in-a', 'in-b'],
      own: ['erp-out'],
    })
  })

  it('takes documents from your systems and sends them to the partner', () => {
    expect(ids('INVOIC')).toEqual({
      partner: ['out'],
      own: ['erp-in'],
    })
  })
})

describe('latestMappingVersions', () => {
  it('keeps the newest version of each Mapping, by Mapping name', () => {
    const versions = [
      version('b', 1, 'Beta'),
      version('a', 2, 'Alpha'),
      version('b', 3, 'Beta'),
      version('a', 1, 'Alpha'),
    ]

    expect(latestMappingVersions(versions).map(({ id }) => id)).toEqual(['a-2', 'b-3'])
  })
})

describe('newestVersion', () => {
  it('finds the highest version', () => {
    expect(newestVersion([version('a', 2), version('a', 4), version('a', 3)])?.version).toBe(4)
  })

  it('is null without newer versions', () => {
    expect(newestVersion([])).toBeNull()
  })
})

describe('chosenOrOnly', () => {
  it('keeps a choice that is still offered', () => {
    expect(chosenOrOnly('b', ['a', 'b'])).toBe('b')
  })

  it('takes the only option when nothing fitting is chosen', () => {
    expect(chosenOrOnly(null, ['a'])).toBe('a')
    expect(chosenOrOnly('gone', ['a'])).toBe('a')
  })

  it('waits for a choice among several options', () => {
    expect(chosenOrOnly(null, ['a', 'b'])).toBeNull()
    expect(chosenOrOnly(null, [])).toBeNull()
  })
})

describe('newDocumentFlow', () => {
  const base = {
    tradingPartnerId: partner,
    partnerChannelId: 'partner-channel',
    ownChannelId: 'own-channel',
    mappingVersionId: 'version',
  }

  it('routes inbound documents from the partner’s connection to your systems', () => {
    expect(newDocumentFlow({ ...base, name: 'Orders', messageType: 'ORDERS' })).toEqual({
      name: 'Orders',
      tradingPartnerId: partner,
      messageType: 'ORDERS',
      inboundChannelId: 'partner-channel',
      destinationChannelId: 'own-channel',
      mappingVersionId: 'version',
    })
  })

  it('routes outbound documents from your systems to the partner’s connection', () => {
    expect(newDocumentFlow({ ...base, name: 'Invoices', messageType: 'INVOIC' })).toMatchObject({
      inboundChannelId: 'own-channel',
      destinationChannelId: 'partner-channel',
    })
  })

  it('shortens a long name to the Flow name length', () => {
    const { name } = newDocumentFlow({
      ...base,
      name: `${'x'.repeat(69)} y`,
      messageType: 'ORDERS',
    })

    expect(name).toBe('x'.repeat(69))
  })
})
