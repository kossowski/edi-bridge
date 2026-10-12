import { describe, expect, it } from 'vitest'

import {
  type MappingVersionEntry,
  mappingVersionEntrySchema,
  maxChangeNoteLength,
  publishMappingDraftBodySchema,
} from './mapping-version-history'

import type { MappingVersionSummary } from './mapping-version'

const version: MappingVersionSummary = {
  id: '0000000b-0000-4000-8000-000000000002',
  mappingId: '00000007-0000-4000-8000-000000000001',
  mappingName: 'Hansemarkt: ERP JSON to DESADV',
  version: 2,
  publishedAt: '2026-09-14T09:00:00.000Z',
}

const entry: MappingVersionEntry = {
  ...version,
  changeNote: 'Despatch number added',
  publishedBy: { id: '0000000b-0000-4000-8000-0000000000aa', name: 'Mara Olsen' },
  flows: [
    {
      id: '00000002-0000-4000-8000-000000000001',
      name: 'Hansemarkt DESADV outbound',
      tradingPartner: { id: '00000001-0000-4000-8000-000000000001', name: 'Hansemarkt' },
    },
  ],
}

describe('mappingVersionEntrySchema', () => {
  it('accepts a version with its change note, publisher and the Flows pinned to it', () => {
    expect(mappingVersionEntrySchema.parse(entry)).toEqual(entry)
  })

  it('accepts an old version without a change note and without pinned Flows', () => {
    const old = { ...entry, changeNote: null, flows: [] }

    expect(mappingVersionEntrySchema.parse(old)).toEqual(old)
  })

  it('rejects an empty change note, since a missing note is null', () => {
    expect(mappingVersionEntrySchema.safeParse({ ...entry, changeNote: '' }).success).toBe(false)
  })
})

describe('publishMappingDraftBodySchema', () => {
  it('moves no Flow unless Flows are chosen', () => {
    expect(publishMappingDraftBodySchema.parse({ changeNote: 'Despatch number added' })).toEqual({
      changeNote: 'Despatch number added',
      moveFlowIds: [],
    })
  })

  it('trims the change note and takes the chosen Flows', () => {
    const flowId = '00000002-0000-4000-8000-000000000001'

    expect(
      publishMappingDraftBodySchema.parse({ changeNote: '  Unit codes  ', moveFlowIds: [flowId] }),
    ).toEqual({ changeNote: 'Unit codes', moveFlowIds: [flowId] })
  })

  it('rejects a change note longer than the limit', () => {
    expect(
      publishMappingDraftBodySchema.safeParse({
        changeNote: 'x'.repeat(maxChangeNoteLength + 1),
      }).success,
    ).toBe(false)
  })

  it('rejects a Flow chosen twice', () => {
    const flowId = '00000002-0000-4000-8000-000000000001'

    expect(
      publishMappingDraftBodySchema.safeParse({ changeNote: '', moveFlowIds: [flowId, flowId] })
        .success,
    ).toBe(false)
  })
})
