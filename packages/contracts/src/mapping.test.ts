import { describe, expect, it } from 'vitest'

import { type MappingDraft, mappingDraftSchema, saveMappingLinksBodySchema } from './mapping'

const outbound: MappingDraft = {
  mappingId: '00000007-0000-4000-8000-000000000001',
  name: 'Hansemarkt: ERP JSON to DESADV',
  direction: 'outbound',
  source: {
    kind: 'documentStructure',
    documentStructureId: '00000006-0000-4000-8000-000000000002',
    name: 'ERP dispatch advice',
  },
  target: { kind: 'messageType', messageType: 'DESADV' },
  links: [{ sourcePath: 'despatchNumber', targetPath: 'BGM/1004' }],
  updatedAt: '2026-09-14T08:30:00.000Z',
}

const inbound: MappingDraft = {
  mappingId: '00000007-0000-4000-8000-000000000002',
  name: 'Hansemarkt: ORDERS to ERP JSON',
  direction: 'inbound',
  source: { kind: 'messageType', messageType: 'ORDERS' },
  target: {
    kind: 'documentStructure',
    documentStructureId: '00000006-0000-4000-8000-000000000001',
    name: 'ERP purchase order',
  },
  links: [{ sourcePath: 'DTM+137/C507/2380', targetPath: 'orderDate' }],
  updatedAt: '2026-09-14T08:30:00.000Z',
}

describe('mappingDraftSchema', () => {
  it.each([outbound, inbound])(
    'accepts an $direction Draft with its source and target',
    (draft) => {
      expect(mappingDraftSchema.parse(draft)).toEqual(draft)
    },
  )

  it('maps a Document Structure to a Message Type outbound, never the other way round', () => {
    const swapped = { ...outbound, source: outbound.target, target: outbound.source }

    expect(mappingDraftSchema.safeParse(swapped).success).toBe(false)
  })

  it('maps a Message Type to a Document Structure inbound, never the other way round', () => {
    const swapped = { ...inbound, source: inbound.target, target: inbound.source }

    expect(mappingDraftSchema.safeParse(swapped).success).toBe(false)
  })
})

describe('saveMappingLinksBodySchema', () => {
  it('accepts no links at all', () => {
    expect(saveMappingLinksBodySchema.parse({ links: [] })).toEqual({ links: [] })
  })

  it('links one source field to several targets', () => {
    const links = [
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+IV/C082/3039' },
    ]

    expect(saveMappingLinksBodySchema.safeParse({ links }).success).toBe(true)
  })

  it('rejects a second link into the same target', () => {
    const links = [
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
      { sourcePath: 'supplier.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
    ]

    expect(saveMappingLinksBodySchema.safeParse({ links }).success).toBe(false)
  })
})
