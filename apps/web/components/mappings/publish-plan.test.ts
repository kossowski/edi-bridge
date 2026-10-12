import { describe, expect, it } from 'vitest'

import {
  maxChangeNoteLength,
  type MappingVersionEntry,
  type PinnedFlow,
} from '@edi-bridge/contracts'

import { changeNoteProblem, chosenRouteIds, routesInUse } from './publish-plan'

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

describe('routesInUse', () => {
  it('lists every document route with the version it uses, by partner and name', () => {
    const rheinkauf = pinned('Orders by AS2', 'Rheinkauf')
    const alpenfrischMail = pinned('Orders by mail', 'Alpenfrisch')
    const alpenfrischSftp = pinned('Orders by SFTP', 'Alpenfrisch')

    expect(
      routesInUse([entry(1, [rheinkauf]), entry(2), entry(3, [alpenfrischSftp, alpenfrischMail])]),
    ).toEqual([
      { id: alpenfrischMail.id, name: 'Orders by mail', partner: 'Alpenfrisch', version: 3 },
      { id: alpenfrischSftp.id, name: 'Orders by SFTP', partner: 'Alpenfrisch', version: 3 },
      { id: rheinkauf.id, name: 'Orders by AS2', partner: 'Rheinkauf', version: 1 },
    ])
  })

  it('lists nothing when no document route uses the Mapping', () => {
    expect(routesInUse([entry(1), entry(2)])).toEqual([])
    expect(routesInUse([])).toEqual([])
  })
})

describe('changeNoteProblem', () => {
  it('asks for a note when it is empty or only spaces', () => {
    expect(changeNoteProblem('')).toBe('missing')
    expect(changeNoteProblem('   \n ')).toBe('missing')
  })

  it('accepts a note up to the limit, ignoring surrounding spaces', () => {
    expect(changeNoteProblem('Delivery date added')).toBeNull()
    expect(changeNoteProblem(`  ${'a'.repeat(maxChangeNoteLength)}  `)).toBeNull()
  })

  it('rejects a note over the limit', () => {
    expect(changeNoteProblem('a'.repeat(maxChangeNoteLength + 1))).toBe('tooLong')
  })
})

describe('chosenRouteIds', () => {
  const routes = routesInUse([
    entry(1, [pinned('Orders by AS2', 'Rheinkauf')]),
    entry(2, [pinned('Orders by SFTP', 'Alpenfrisch'), pinned('Orders by mail', 'Nordwind')]),
  ])

  it('moves nothing unless chosen', () => {
    expect(chosenRouteIds(routes, new Set())).toEqual([])
  })

  it('moves only the chosen routes, in the listed order', () => {
    const [first, , third] = routes

    expect(chosenRouteIds(routes, new Set([third!.id, first!.id]))).toEqual([first!.id, third!.id])
  })

  it('ignores a choice for a route that no longer uses the Mapping', () => {
    expect(chosenRouteIds(routes, new Set([crypto.randomUUID()]))).toEqual([])
  })
})
