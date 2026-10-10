import { describe, expect, it } from 'vitest'

import { type MappingDraft, mappingDraftSchema, saveMappingDraftBodySchema } from './mapping'

import type { MappingTransform, TransformLink } from './transform'

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
  transforms: [],
  transformLinks: [],
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
  transforms: [],
  transformLinks: [],
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

const dateFormat: MappingTransform = {
  id: '0000000a-0000-4000-8000-000000000001',
  kind: 'dateFormat',
  position: { x: 0, y: 0 },
  config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
}

const dateIntoDtm: TransformLink[] = [
  {
    from: { kind: 'source', path: 'documentDate' },
    to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
  },
  {
    from: { kind: 'transform', transformId: dateFormat.id, output: 'value' },
    to: { kind: 'target', path: 'DTM+137/C507/2380' },
  },
]

function graph(overrides: Partial<Parameters<typeof saveMappingDraftBodySchema.parse>[0]> = {}) {
  return { links: [], transforms: [dateFormat], transformLinks: dateIntoDtm, ...overrides }
}

describe('saveMappingDraftBodySchema', () => {
  it('accepts no links and no transforms at all', () => {
    const empty = { links: [], transforms: [], transformLinks: [] }

    expect(saveMappingDraftBodySchema.parse(empty)).toEqual(empty)
  })

  it('links a source field through a transform into a target element', () => {
    expect(saveMappingDraftBodySchema.parse(graph())).toEqual(graph())
  })

  it('links one source field to several targets', () => {
    const links = [
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+IV/C082/3039' },
    ]

    expect(saveMappingDraftBodySchema.safeParse(graph({ links })).success).toBe(true)
  })

  it('rejects a second link into the same target', () => {
    const links = [
      { sourcePath: 'buyer.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
      { sourcePath: 'supplier.gln', targetPath: 'SG2/NAD+BY/C082/3039' },
    ]

    expect(saveMappingDraftBodySchema.safeParse(graph({ links })).success).toBe(false)
  })

  it('rejects a transform link into a target that a plain link already fills', () => {
    const links = [{ sourcePath: 'documentDate', targetPath: 'DTM+137/C507/2380' }]

    expect(saveMappingDraftBodySchema.safeParse(graph({ links })).success).toBe(false)
  })

  it('rejects a transform link straight from a source field to a target element', () => {
    const transformLinks = [
      ...dateIntoDtm,
      { from: { kind: 'source', path: 'despatchDate' }, to: { kind: 'target', path: 'BGM/1004' } },
    ]

    expect(saveMappingDraftBodySchema.safeParse(graph({ transformLinks })).success).toBe(false)
  })

  it('rejects two transforms with the same id', () => {
    const transforms = [dateFormat, { ...dateFormat, position: { x: 10, y: 10 } }]

    expect(saveMappingDraftBodySchema.safeParse(graph({ transforms })).success).toBe(false)
  })

  it.each([
    [
      'a transform that is not on the Draft',
      {
        from: { kind: 'source', path: 'despatchDate' },
        to: {
          kind: 'transform',
          transformId: '0000000a-0000-4000-8000-000000000099',
          input: 'value',
        },
      },
    ],
    [
      'an input the transform does not have',
      {
        from: { kind: 'source', path: 'despatchDate' },
        to: { kind: 'transform', transformId: dateFormat.id, input: 'then' },
      },
    ],
    [
      'an output the transform does not have',
      {
        from: { kind: 'transform', transformId: dateFormat.id, output: 'counter' },
        to: { kind: 'target', path: 'DTM+11/C507/2380' },
      },
    ],
  ])('rejects a link to %s', (_, link) => {
    const transformLinks = [...dateIntoDtm, link]

    expect(saveMappingDraftBodySchema.safeParse(graph({ transformLinks })).success).toBe(false)
  })

  it('rejects a second link into the same transform input', () => {
    const transformLinks = [
      ...dateIntoDtm,
      {
        from: { kind: 'source', path: 'despatchDate' },
        to: { kind: 'transform', transformId: dateFormat.id, input: 'value' },
      },
    ]

    expect(saveMappingDraftBodySchema.safeParse(graph({ transformLinks })).success).toBe(false)
  })

  it('chains transforms and feeds one output into several inputs', () => {
    const constant: MappingTransform = {
      id: '0000000a-0000-4000-8000-000000000002',
      kind: 'constant',
      position: { x: 0, y: 100 },
      config: { value: 'n/a' },
    }

    const conditional: MappingTransform = {
      id: '0000000a-0000-4000-8000-000000000003',
      kind: 'conditional',
      position: { x: 200, y: 100 },
      config: { operator: 'isEmpty', compareTo: '' },
    }

    const transformLinks: TransformLink[] = [
      ...dateIntoDtm,
      ...(['value', 'then'] as const).map((input) => ({
        from: { kind: 'transform' as const, transformId: constant.id, output: 'value' },
        to: { kind: 'transform' as const, transformId: conditional.id, input },
      })),
      {
        from: { kind: 'transform', transformId: conditional.id, output: 'value' },
        to: { kind: 'target', path: 'BGM/1004' },
      },
    ]

    expect(
      saveMappingDraftBodySchema.safeParse(
        graph({ transforms: [dateFormat, constant, conditional], transformLinks }),
      ).success,
    ).toBe(true)
  })

  it('rejects transforms that feed each other in a circle', () => {
    const second: MappingTransform = { ...dateFormat, id: '0000000a-0000-4000-8000-000000000002' }

    const between = (from: string, to: string): TransformLink => ({
      from: { kind: 'transform', transformId: from, output: 'value' },
      to: { kind: 'transform', transformId: to, input: 'value' },
    })

    const transformLinks = [between(dateFormat.id, second.id), between(second.id, dateFormat.id)]

    expect(
      saveMappingDraftBodySchema.safeParse(
        graph({ transforms: [dateFormat, second], transformLinks }),
      ).success,
    ).toBe(false)
  })
})

describe('mappingDraftSchema graph', () => {
  it('accepts a Draft with transforms', () => {
    const draft = { ...outbound, transforms: [dateFormat], transformLinks: dateIntoDtm }

    expect(mappingDraftSchema.parse(draft)).toEqual(draft)
  })

  it('holds a Draft to the same graph rules as a save', () => {
    const draft = { ...outbound, transforms: [], transformLinks: dateIntoDtm }

    expect(mappingDraftSchema.safeParse(draft).success).toBe(false)
  })
})
