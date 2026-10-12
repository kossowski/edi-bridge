import { describe, expect, it } from 'vitest'

import type { MappingVersionEntry, PinnedFlow } from '@edi-bridge/contracts'

import { failedDocumentsQuery, failedDocumentsShown, liveVersions } from './version-history'

const mappingId = '6f0e1c1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'

function pinned(name: string, partner: string): PinnedFlow {
  return {
    id: crypto.randomUUID(),
    name,
    tradingPartner: { id: crypto.randomUUID(), name: partner },
  }
}

function entry(version: number, flows: PinnedFlow[] = []): MappingVersionEntry {
  return {
    id: crypto.randomUUID(),
    mappingId,
    mappingName: 'ORDERS to ERP JSON',
    version,
    publishedAt: '2026-10-01T08:00:00.000Z',
    changeNote: null,
    publishedBy: { id: crypto.randomUUID(), name: 'Admin' },
    flows,
  }
}

describe('liveVersions', () => {
  it('lists the versions that document routes use, newest first', () => {
    const versions = [
      entry(1, [pinned('Orders in', 'Rheinkauf')]),
      entry(2),
      entry(3, [pinned('Orders in', 'Nordwind')]),
    ]

    expect(liveVersions(versions)).toEqual([
      { version: 3, partners: ['Nordwind'] },
      { version: 1, partners: ['Rheinkauf'] },
    ])
  })

  it('names each partner of a version once, in alphabetical order', () => {
    const versions = [
      entry(4, [
        pinned('Orders by AS2', 'Ölwerk'),
        pinned('Orders by SFTP', 'Alpenfrisch'),
        pinned('Orders by mail', 'Ölwerk'),
      ]),
    ]

    expect(liveVersions(versions)).toEqual([{ version: 4, partners: ['Alpenfrisch', 'Ölwerk'] }])
  })

  it('finds nothing live when no document route uses the mapping', () => {
    expect(liveVersions([entry(1), entry(2)])).toEqual([])
    expect(liveVersions([])).toEqual([])
  })
})

describe('failedDocumentsQuery', () => {
  it('asks for the failed documents of the mapping in the last 7 days', () => {
    expect(failedDocumentsQuery(mappingId, new Date('2026-10-12T14:35:27.512Z'))).toEqual({
      mappingId: [mappingId],
      status: ['failed'],
      receivedFrom: '2026-10-05T14:35:00.000Z',
      page: 1,
      pageSize: failedDocumentsShown,
    })
  })

  it('stays the same within a minute', () => {
    expect(failedDocumentsQuery(mappingId, new Date('2026-10-12T14:35:01.000Z'))).toEqual(
      failedDocumentsQuery(mappingId, new Date('2026-10-12T14:35:59.999Z')),
    )
  })
})
