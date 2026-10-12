import { describe, expect, it } from 'vitest'

import {
  maxChangeNoteLength,
  type MappingVersionEntry,
  type PinnedFlow,
} from '@edi-bridge/contracts'

import { changeNoteProblem, chosenFlowIds } from './publish-plan'
import { flowsInUse } from './version-history'

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

describe('chosenFlowIds', () => {
  const flows = flowsInUse([
    entry(1, [pinned('Orders by AS2', 'Rheinkauf')]),
    entry(2, [pinned('Orders by SFTP', 'Alpenfrisch'), pinned('Orders by mail', 'Nordwind')]),
  ])

  it('moves nothing unless chosen', () => {
    expect(chosenFlowIds(flows, new Set())).toEqual([])
  })

  it('moves only the chosen Flows, in the listed order', () => {
    const [first, , third] = flows

    expect(chosenFlowIds(flows, new Set([third!.id, first!.id]))).toEqual([first!.id, third!.id])
  })

  it('ignores a choice for a Flow that no longer uses the Mapping', () => {
    expect(chosenFlowIds(flows, new Set([crypto.randomUUID()]))).toEqual([])
  })
})
