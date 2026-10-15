import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  DocumentFieldType,
  DocumentStructure,
  DocumentStructureNode,
  MappingLink,
  MappingTransform,
  TransformLink,
} from '@edi-bridge/contracts'
import type { Message, Segment } from '@edi-bridge/edifact'

import { applyInboundMappingVersion, type InboundMappingVersion, MappingError } from './index'

const documentStructureId = '5c2a8f61-1b3d-4e7a-9c0f-8d6e5b4a3f21'

function inboundVersion(
  links: MappingLink[],
  {
    transforms = [],
    transformLinks = [],
  }: Pick<Partial<InboundMappingVersion>, 'transforms' | 'transformLinks'> = {},
): InboundMappingVersion {
  return {
    id: '7d1f3c52-3c1e-4c6b-9a43-2f0d1e8b5a10',
    mappingId: '0b9e6a4e-8d2f-4f5c-b1a7-6c3d2e1f0a98',
    mappingName: 'Retailer orders',
    version: 1,
    publishedAt: '2026-10-14T09:30:00.000Z',
    direction: 'inbound',
    source: { kind: 'messageType', messageType: 'ORDERS' },
    target: { kind: 'documentStructure', documentStructureId, name: 'ERP order' },
    links,
    transforms,
    transformLinks,
  }
}

const lineLoopId = '3e8c1a27-5b4d-4f6e-8a9b-1c2d3e4f5a6b'

const loopOf = (id: string, counterStart = 1): MappingTransform => ({
  id,
  kind: 'loop',
  position: { x: 0, y: 0 },
  config: { counterStart },
})

function looped(
  sourcePart: string,
  targetPart: string,
  counterTarget?: string,
  transformId = lineLoopId,
): TransformLink[] {
  return [
    {
      from: { kind: 'source', path: sourcePart },
      to: { kind: 'transform', transformId, input: 'items' },
    },
    {
      from: { kind: 'transform', transformId, output: 'items' },
      to: { kind: 'target', path: targetPart },
    },
    ...(counterTarget === undefined
      ? []
      : [
          {
            from: { kind: 'transform', transformId, output: 'counter' },
            to: { kind: 'target', path: counterTarget },
          } as const,
        ]),
  ]
}

const priceLoopId = '9a4b2c1d-6e7f-4a8b-9c0d-1e2f3a4b5c6d'

const lineLoop = (counterTarget?: string) => ({
  transforms: [loopOf(lineLoopId)],
  transformLinks: looped('SG25', 'lines[]', counterTarget),
})

const named = (path: string, required: boolean) => ({
  path,
  name: path.split('.').at(-1)!,
  label: path,
  labelReason: null,
  labelUnsure: false,
  required,
})

const field = (
  path: string,
  { type = 'string', required = false }: { type?: DocumentFieldType; required?: boolean } = {},
): DocumentStructureNode => ({ ...named(path, required), kind: 'field', type })

const object = (
  path: string,
  children: DocumentStructureNode[],
  required = false,
): DocumentStructureNode => ({ ...named(path, required), kind: 'object', children })

const array = (
  path: string,
  items: (path: string) => DocumentStructureNode,
  required = false,
): DocumentStructureNode => {
  const content = items(path)

  if (content.kind === 'array') {
    throw new Error(`The items of ${path} cannot be an array`)
  }

  return {
    ...named(path, required),
    name: path.split('.').at(-1)!.slice(0, -2),
    kind: 'array',
    items: { ...content, required: true },
  }
}

function structureOf(children: DocumentStructureNode[]): DocumentStructure {
  return {
    id: documentStructureId,
    name: 'ERP order',
    format: 'json',
    root: 'object',
    sample: null,
    children,
  }
}

const header: Segment = {
  tag: 'UNH',
  elements: [['1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']],
}

const messageOf = (segments: Segment[]): Message => ({
  header,
  segments,
  trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], ['1']] },
})

const order = messageOf([
  { tag: 'BGM', elements: [['220'], ['PO-4711'], ['9']] },
  { tag: 'DTM', elements: [['137', '20261014', '102']] },
  { tag: 'DTM', elements: [['2', '20261020', '102']] },
  { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
  { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
  { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
  { tag: 'QTY', elements: [['21', '12']] },
  { tag: 'UNS', elements: [['S']] },
  { tag: 'CNT', elements: [['2', '1']] },
])

const twoLines = messageOf([
  { tag: 'BGM', elements: [['220'], ['PO-4711'], ['9']] },
  { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
  { tag: 'QTY', elements: [['21', '12']] },
  { tag: 'PRI', elements: [['AAA', '1.20']] },
  { tag: 'PRI', elements: [['AAA', '1.10']] },
  { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
  { tag: 'QTY', elements: [['21', '6']] },
  { tag: 'UNS', elements: [['S']] },
])

const apply = (version: InboundMappingVersion, structure: DocumentStructure, message: Message) =>
  Effect.runPromise(applyInboundMappingVersion(version, structure, message))

const failure = (version: InboundMappingVersion, structure: DocumentStructure, message: Message) =>
  Effect.runPromise(Effect.flip(applyInboundMappingVersion(version, structure, message)))

describe('applyInboundMappingVersion', () => {
  it('copies an element of the Message into a field of the Document', async () => {
    const version = inboundVersion([{ sourcePath: 'BGM/1004', targetPath: 'orderNumber' }])

    expect(await apply(version, structureOf([field('orderNumber')]), order)).toEqual({
      orderNumber: 'PO-4711',
    })
  })

  it('tells segments apart by their qualifier and reads components of composites', async () => {
    const version = inboundVersion([
      { sourcePath: 'DTM+2/C507/2380', targetPath: 'deliveryDate' },
      { sourcePath: 'DTM+137/C507/2380', targetPath: 'orderDate' },
    ])

    const structure = structureOf([field('orderDate'), field('deliveryDate')])

    expect(await apply(version, structure, order)).toEqual({
      orderDate: '20261014',
      deliveryDate: '20261020',
    })
  })

  it('reads segments in segment groups into nested fields', async () => {
    const version = inboundVersion([
      { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'buyer.gln' },
      { sourcePath: 'SG2+SU/NAD+SU/C082/3039', targetPath: 'supplier.gln' },
    ])

    const structure = structureOf([
      object('buyer', [field('buyer.gln')]),
      object('supplier', [field('supplier.gln')]),
    ])

    expect(await apply(version, structure, order)).toEqual({
      buyer: { gln: '4012345000009' },
      supplier: { gln: '4000001000005' },
    })
  })

  it('reads segments behind repeated groups and segments the structure does not know', async () => {
    const version = inboundVersion([
      { sourcePath: 'UNH/0062', targetPath: 'messageReference' },
      { sourcePath: 'CNT+2/C270/6066', targetPath: 'lineCount' },
    ])

    const message = messageOf([
      { tag: 'BGM', elements: [['220'], ['PO-4711'], ['9']] },
      { tag: 'DTM', elements: [['137', '20261014', '102']] },
      { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
      { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'ALI', elements: [['DE']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['21', '6']] },
      { tag: 'UNS', elements: [['S']] },
      { tag: 'CNT', elements: [['2', '2']] },
    ])

    const structure = structureOf([field('messageReference'), field('lineCount')])

    expect(await apply(version, structure, message)).toEqual({
      messageReference: '1',
      lineCount: '2',
    })
  })

  it('writes a value into a number field as a number', async () => {
    const version = inboundVersion([
      { sourcePath: 'UNT/0074', targetPath: 'segmentCount' },
      { sourcePath: 'CNT+2/C270/6066', targetPath: 'controlValue' },
    ])

    const message = messageOf([{ tag: 'CNT', elements: [['2', '12,5']] }])

    const structure = structureOf([
      field('segmentCount', { type: 'integer' }),
      field('controlValue', { type: 'number' }),
    ])

    expect(await apply(version, structure, message)).toEqual({
      segmentCount: 3,
      controlValue: 12.5,
    })
  })

  it.each([
    ['number', 'twelve'],
    ['integer', '12.5'],
  ] as const)('fails when a %s field gets %s', async (type, value) => {
    const version = inboundVersion([{ sourcePath: 'CNT+2/C270/6066', targetPath: 'controlValue' }])
    const message = messageOf([{ tag: 'CNT', elements: [['2', value]] }])

    expect(await failure(version, structureOf([field('controlValue', { type })]), message)).toEqual(
      new MappingError({ code: 'invalidNumber', targetPath: 'controlValue' }),
    )
  })

  it.each(['orderId', 'buyer'])(
    'fails on a link to %s, which is no field of the Document',
    async (targetPath) => {
      const version = inboundVersion([{ sourcePath: 'BGM/1004', targetPath }])
      const structure = structureOf([field('orderNumber'), object('buyer', [field('buyer.gln')])])

      expect(await failure(version, structure, order)).toEqual(
        new MappingError({ code: 'unknownTarget', targetPath }),
      )
    },
  )

  it.each(['BGM/9999', 'SG2+BY/NAD+BY/C082'])(
    'fails on a link from %s, which is no element of the Message Type',
    async (sourcePath) => {
      const version = inboundVersion([{ sourcePath, targetPath: 'orderNumber' }])

      expect(await failure(version, structureOf([field('orderNumber')]), order)).toEqual(
        new MappingError({ code: 'unknownSource', targetPath: 'orderNumber', sourcePath }),
      )
    },
  )

  it('fails when a required field gets no value', async () => {
    const version = inboundVersion([
      { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
      { sourcePath: 'SG2+DP/NAD+DP/C082/3039', targetPath: 'buyer.deliveryParty' },
    ])

    const structure = structureOf([
      field('orderNumber', { required: true }),
      object('buyer', [field('buyer.gln', { required: true }), field('buyer.deliveryParty')]),
    ])

    const message = messageOf([
      { tag: 'BGM', elements: [['220'], ['PO-4711'], ['9']] },
      { tag: 'NAD', elements: [['DP'], ['4012345000016', '', '9']] },
    ])

    expect(await failure(version, structure, message)).toEqual(
      new MappingError({ code: 'missingRequiredValue', targetPath: 'buyer.gln' }),
    )
  })

  it('leaves out an optional object without values, though its fields are required', async () => {
    const version = inboundVersion([
      { sourcePath: 'BGM/1004', targetPath: 'orderNumber' },
      { sourcePath: 'SG2+DP/NAD+DP/C082/3039', targetPath: 'deliveryParty.gln' },
    ])

    const structure = structureOf([
      field('orderNumber', { required: true }),
      object('deliveryParty', [field('deliveryParty.gln', { required: true })]),
    ])

    expect(await apply(version, structure, order)).toEqual({ orderNumber: 'PO-4711' })
  })

  it('fails when a required object gets no values', async () => {
    const version = inboundVersion([
      { sourcePath: 'SG2+DP/NAD+DP/C082/3039', targetPath: 'deliveryParty.gln' },
    ])

    const structure = structureOf([
      object('deliveryParty', [field('deliveryParty.gln', { required: true })], true),
    ])

    expect(await failure(version, structure, order)).toEqual(
      new MappingError({ code: 'missingRequiredValue', targetPath: 'deliveryParty.gln' }),
    )
  })

  it('maps each repetition of a looped segment group to an item of the array', async () => {
    const version = inboundVersion(
      [
        { sourcePath: 'SG25/LIN/C212/7140', targetPath: 'lines[].gtin' },
        { sourcePath: 'SG25/QTY+21/C186/6060', targetPath: 'lines[].quantity' },
      ],
      lineLoop(),
    )

    const structure = structureOf([
      array('lines[]', (path) =>
        object(path, [field(`${path}.gtin`), field(`${path}.quantity`, { type: 'number' })]),
      ),
    ])

    expect(await apply(version, structure, twoLines)).toEqual({
      lines: [
        { gtin: '4000862141404', quantity: 12 },
        { gtin: '4000862141411', quantity: 6 },
      ],
    })
  })

  it('numbers the items of the array with the counter of the loop', async () => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/LIN/C212/7140', targetPath: 'lines[].gtin' }],
      lineLoop('lines[].position'),
    )

    const structure = structureOf([
      array('lines[]', (path) =>
        object(path, [field(`${path}.position`, { type: 'integer' }), field(`${path}.gtin`)]),
      ),
    ])

    expect(await apply(version, structure, twoLines)).toEqual({
      lines: [
        { position: 1, gtin: '4000862141404' },
        { position: 2, gtin: '4000862141411' },
      ],
    })
  })

  it('maps repetitions of a nested segment group to an array in each item', async () => {
    const version = inboundVersion(
      [
        { sourcePath: 'SG25/LIN/C212/7140', targetPath: 'lines[].gtin' },
        { sourcePath: 'SG25/SG28/PRI+AAA/C509/5118', targetPath: 'lines[].prices[]' },
      ],
      {
        transforms: [loopOf(lineLoopId), loopOf(priceLoopId)],
        transformLinks: [
          ...looped('SG25', 'lines[]'),
          ...looped('SG25/SG28', 'lines[].prices[]', undefined, priceLoopId),
        ],
      },
    )

    const structure = structureOf([
      array('lines[]', (path) =>
        object(path, [
          field(`${path}.gtin`),
          array(`${path}.prices[]`, (prices) => field(prices, { type: 'number' })),
        ]),
      ),
    ])

    const message = messageOf([
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'PRI', elements: [['AAA', '1.20']] },
      { tag: 'PRI', elements: [['AAA', '1.10']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'PRI', elements: [['AAA', '2.40']] },
    ])

    expect(await apply(version, structure, message)).toEqual({
      lines: [
        { gtin: '4000862141404', prices: [1.2, 1.1] },
        { gtin: '4000862141411', prices: [2.4] },
      ],
    })
  })

  it('repeats a header value linked beneath the loop in every row', async () => {
    const version = inboundVersion(
      [
        { sourcePath: 'BGM/1004', targetPath: 'rows[].orderNumber' },
        { sourcePath: 'SG25/LIN/C212/7140', targetPath: 'rows[].gtin' },
      ],
      { transforms: [loopOf(lineLoopId)], transformLinks: looped('SG25', 'rows[]') },
    )

    const structure = structureOf([
      array('rows[]', (path) =>
        object(path, [field(`${path}.orderNumber`), field(`${path}.gtin`)]),
      ),
    ])

    expect(await apply(version, structure, twoLines)).toEqual({
      rows: [
        { orderNumber: 'PO-4711', gtin: '4000862141404' },
        { orderNumber: 'PO-4711', gtin: '4000862141411' },
      ],
    })
  })

  it.each([
    ['leaves out an optional array', false, {}],
    ['writes a required array empty', true, { lines: [] }],
  ])('%s when the looped segment group does not repeat', async (_, required, expected) => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/LIN/C212/7140', targetPath: 'lines[].gtin' }],
      lineLoop(),
    )

    const structure = structureOf([
      array('lines[]', (path) => object(path, [field(`${path}.gtin`)]), required),
    ])

    expect(await apply(version, structure, messageOf([]))).toEqual(expected)
  })

  it('writes plain links beneath an array without a loop into one item', async () => {
    const version = inboundVersion([
      { sourcePath: 'BGM/1004', targetPath: 'references[].number' },
      { sourcePath: 'SG2+BY/NAD+BY/C082/3039', targetPath: 'parties[]' },
    ])

    const structure = structureOf([
      array('references[]', (path) => object(path, [field(`${path}.number`)])),
      array('parties[]', (path) => field(path)),
      array('notes[]', (path) => field(path)),
    ])

    expect(await apply(version, structure, order)).toEqual({
      references: [{ number: 'PO-4711' }],
      parties: ['4012345000009'],
    })
  })

  it('writes an optional object that holds only the items of a loop', async () => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/LIN/C212/7140', targetPath: 'order.lines[].gtin' }],
      { transforms: [loopOf(lineLoopId)], transformLinks: looped('SG25', 'order.lines[]') },
    )

    const structure = structureOf([
      object('order', [array('order.lines[]', (path) => object(path, [field(`${path}.gtin`)]))]),
    ])

    expect(await apply(version, structure, twoLines)).toEqual({
      order: { lines: [{ gtin: '4000862141404' }, { gtin: '4000862141411' }] },
    })
  })

  it('writes an array without a loop that holds only the items of a loop', async () => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/LIN/C212/7140', targetPath: 'orders[].lines[].gtin' }],
      { transforms: [loopOf(lineLoopId)], transformLinks: looped('SG25', 'orders[].lines[]') },
    )

    const structure = structureOf([
      array('orders[]', (path) =>
        object(path, [
          array(`${path}.lines[]`, (lines) => object(lines, [field(`${lines}.gtin`)])),
        ]),
      ),
    ])

    expect(await apply(version, structure, twoLines)).toEqual({
      orders: [{ lines: [{ gtin: '4000862141404' }, { gtin: '4000862141411' }] }],
    })
  })

  it('reads the first repetition of a repeating segment group that no loop repeats', async () => {
    const version = inboundVersion(
      [
        { sourcePath: 'SG7/CUX/C504/6345', targetPath: 'currency' },
        { sourcePath: 'SG25/LIN/C212/7140', targetPath: 'lines[].gtin' },
      ],
      lineLoop(),
    )

    const structure = structureOf([
      field('currency'),
      array('lines[]', (path) => object(path, [field(`${path}.gtin`)])),
    ])

    const message = messageOf([
      { tag: 'BGM', elements: [['220'], ['PO-4711'], ['9']] },
      { tag: 'CUX', elements: [['2', 'EUR', '9']] },
      { tag: 'CUX', elements: [['3', 'USD', '4']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
    ])

    expect(await apply(version, structure, message)).toEqual({
      currency: 'EUR',
      lines: [{ gtin: '4000862141404' }],
    })
  })

  it('loops over a nested segment group in the first repetition of its unlooped parent', async () => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/SG28/PRI+AAA/C509/5118', targetPath: 'prices[]' }],
      {
        transforms: [loopOf(priceLoopId)],
        transformLinks: looped('SG25/SG28', 'prices[]', undefined, priceLoopId),
      },
    )

    const structure = structureOf([array('prices[]', (path) => field(path, { type: 'number' }))])

    expect(await apply(version, structure, twoLines)).toEqual({ prices: [1.2, 1.1] })
  })

  it.each([
    [
      'a loop repeats the line item group into another array',
      'SG25/LIN/C212/7140',
      'gtin',
      looped('SG25', 'lines[]'),
    ],
    [
      'only the line loop encloses it, not the one over the prices',
      'SG25/SG28/PRI+AAA/C509/5118',
      'lines[].price',
      [
        ...looped('SG25', 'lines[]'),
        ...looped('SG25/SG28', 'lines[].prices[]', undefined, priceLoopId),
      ],
    ],
  ])(
    'fails on a link from a repeating segment group when %s',
    async (_, sourcePath, targetPath, transformLinks) => {
      const version = inboundVersion([{ sourcePath, targetPath }], {
        transforms: [loopOf(lineLoopId), loopOf(priceLoopId)],
        transformLinks,
      })

      const structure = structureOf([
        field('gtin'),
        array('lines[]', (path) =>
          object(path, [
            field(`${path}.price`),
            array(`${path}.prices[]`, (prices) => field(prices)),
          ]),
        ),
      ])

      expect(await failure(version, structure, twoLines)).toEqual(
        new MappingError({ code: 'outsideLoop', targetPath }),
      )
    },
  )

  it('fails on a loop over a nested segment group outside the loop over its parent', async () => {
    const version = inboundVersion([], {
      transforms: [loopOf(lineLoopId), loopOf(priceLoopId)],
      transformLinks: [
        ...looped('SG25', 'lines[]'),
        ...looped('SG25/SG28', 'prices[]', undefined, priceLoopId),
      ],
    })

    const structure = structureOf([
      array('lines[]', (path) => field(path)),
      array('prices[]', (path) => field(path)),
    ])

    expect(await failure(version, structure, twoLines)).toEqual(
      new MappingError({ code: 'outsideLoop', targetPath: 'prices[]' }),
    )
  })

  it.each(['BGM', 'SG99'])(
    'fails on a loop over %s, which is no segment group of the Message Type',
    async (sourcePart) => {
      const version = inboundVersion([], {
        transforms: [loopOf(lineLoopId)],
        transformLinks: looped(sourcePart, 'lines[]'),
      })

      const structure = structureOf([array('lines[]', (path) => field(path))])

      expect(await failure(version, structure, twoLines)).toEqual(
        new MappingError({ code: 'unknownSource', targetPath: 'lines[]', sourcePath: sourcePart }),
      )
    },
  )

  it.each([
    ['the loop items into an object', 'buyer', undefined, 'buyer'],
    ['the loop items into a field', 'buyer.gln', undefined, 'buyer.gln'],
    ['the counter into an array', 'lines[]', 'lines[]', 'lines[]'],
  ])('fails on a link of %s', async (_, targetPart, counterTarget, targetPath) => {
    const version = inboundVersion([], {
      transforms: [loopOf(lineLoopId)],
      transformLinks: looped('SG25', targetPart, counterTarget),
    })

    const structure = structureOf([
      object('buyer', [field('buyer.gln')]),
      array('lines[]', (path) => object(path, [field(`${path}.gtin`)])),
    ])

    expect(await failure(version, structure, twoLines)).toEqual(
      new MappingError({ code: 'unknownTarget', targetPath }),
    )
  })

  it('fails on the counter of a loop that counts from below zero', async () => {
    const version = inboundVersion([], {
      transforms: [loopOf(lineLoopId, -1)],
      transformLinks: looped('SG25', 'lines[]', 'lines[].position'),
    })

    const structure = structureOf([
      array('lines[]', (path) => object(path, [field(`${path}.position`)])),
    ])

    expect(await failure(version, structure, twoLines)).toEqual(
      new MappingError({
        code: 'invalidTransform',
        targetPath: 'lines[].position',
        transformId: lineLoopId,
      }),
    )
  })

  it('fails when an item of the array gets no value for a required field', async () => {
    const version = inboundVersion(
      [{ sourcePath: 'SG25/QTY+21/C186/6060', targetPath: 'lines[].quantity' }],
      lineLoop('lines[].position'),
    )

    const structure = structureOf([
      array('lines[]', (path) =>
        object(path, [field(`${path}.position`), field(`${path}.quantity`, { required: true })]),
      ),
    ])

    const message = messageOf([
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
    ])

    expect(await failure(version, structure, message)).toEqual(
      new MappingError({ code: 'missingRequiredValue', targetPath: 'lines[].quantity' }),
    )
  })
})
