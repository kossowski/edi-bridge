import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  JsonContent,
  MappingLink,
  MappingTransform,
  MessageType,
  TransformLink,
} from '@edi-bridge/contracts'

import { applyMappingVersion, MappingError, type OutboundMappingVersion } from './index'

function outboundVersion(
  messageType: MessageType,
  links: MappingLink[],
  {
    transforms = [],
    transformLinks = [],
  }: Pick<Partial<OutboundMappingVersion>, 'transforms' | 'transformLinks'> = {},
): OutboundMappingVersion {
  return {
    id: '7d1f3c52-3c1e-4c6b-9a43-2f0d1e8b5a10',
    mappingId: '0b9e6a4e-8d2f-4f5c-b1a7-6c3d2e1f0a98',
    mappingName: 'ERP invoices',
    version: 1,
    publishedAt: '2026-10-14T09:30:00.000Z',
    direction: 'outbound',
    source: {
      kind: 'documentStructure',
      documentStructureId: '5c2a8f61-1b3d-4e7a-9c0f-8d6e5b4a3f21',
      name: 'ERP invoice',
    },
    target: { kind: 'messageType', messageType },
    links,
    transforms,
    transformLinks,
  }
}

const apply = (version: OutboundMappingVersion, document: JsonContent) =>
  Effect.runSync(applyMappingVersion(version, document))

const failure = (version: OutboundMappingVersion, document: JsonContent) =>
  Effect.runSync(Effect.flip(applyMappingVersion(version, document)))

const orderHeader: MappingLink[] = [
  { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
  { sourcePath: 'orderDate', targetPath: 'DTM+137/C507/2380' },
  { sourcePath: 'dateFormat', targetPath: 'DTM+137/C507/2379' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
  { sourcePath: 'supplier.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
]

const order = {
  orderNumber: 'PO-4711',
  orderDate: '20261014',
  dateFormat: '102',
  buyer: { gln: '4012345000009' },
  supplier: { gln: '4000001000005' },
}

const despatchHeader: MappingLink[] = [
  { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' },
  { sourcePath: 'despatchDate', targetPath: 'DTM+137/C507/2380' },
  { sourcePath: 'dateFormat', targetPath: 'DTM+137/C507/2379' },
  { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
  { sourcePath: 'supplier.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
  { sourcePath: 'deliveryParty.gln', targetPath: 'SG2+DP/NAD+DP/C082/3039' },
  { sourcePath: 'consignment', targetPath: 'SG10/CPS/7164' },
]

const despatch = {
  despatchNumber: 'DES-0815',
  despatchDate: '20261015',
  dateFormat: '102',
  buyer: { gln: '4012345000009' },
  supplier: { gln: '4000001000005' },
  deliveryParty: { gln: '4012345000016' },
  consignment: '1',
}

const loopId = '3e8c1a27-5b4d-4f6e-8a9b-1c2d3e4f5a6b'

const loopOf = (id: string): MappingTransform => ({
  id,
  kind: 'loop',
  position: { x: 0, y: 0 },
  config: { counterStart: 1 },
})

const loop = loopOf(loopId)

const packageLoopId = '9a4b2c1d-6e7f-4a8b-9c0d-1e2f3a4b5c6d'

function looped(
  sourcePart: string,
  targetPart: string,
  counterTarget?: string,
  transformId = loopId,
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

const orderLines: MappingLink[] = [
  { sourcePath: 'lines[].gtin', targetPath: 'SG25/LIN/C212/7140' },
  { sourcePath: 'lines[].quantity', targetPath: 'SG25/QTY+21/C186/6060' },
]

const orderLoop = { transforms: [loop], transformLinks: looped('lines[]', 'SG25', 'SG25/LIN/1082') }

const transformOf = (
  id: string,
  transform: Pick<MappingTransform, 'kind' | 'config'>,
): MappingTransform =>
  // SAFETY: each test passes a config that belongs to its kind.
  ({ id, position: { x: 0, y: 0 }, ...transform }) as MappingTransform

const transformId = '5d6e7f80-1a2b-4c3d-8e4f-5a6b7c8d9e0f'

const fromSource = (path: string, input = 'value', id = transformId): TransformLink => ({
  from: { kind: 'source', path },
  to: { kind: 'transform', transformId: id, input },
})

const intoTarget = (path: string, id = transformId, output = 'value'): TransformLink => ({
  from: { kind: 'transform', transformId: id, output },
  to: { kind: 'target', path },
})

const orderWithoutNumber = orderHeader.filter(({ targetPath }) => targetPath !== 'BGM/1004')

const orderVia = (
  transform: Pick<MappingTransform, 'kind' | 'config'>,
  transformLinks: TransformLink[],
) =>
  outboundVersion('ORDERS', [...orderWithoutNumber, ...orderLines], {
    transforms: [loop, transformOf(transformId, transform)],
    transformLinks: [...looped('lines[]', 'SG25', 'SG25/LIN/1082'), ...transformLinks],
  })

const orderWithLine = { ...order, lines: [{ gtin: '4000862141404', quantity: 12 }] }

const orderNumberOf = (version: OutboundMappingVersion, document: JsonContent = orderWithLine) =>
  apply(version, document).segments[0]

describe('applyMappingVersion', () => {
  it('places plain links in the order of the Message Type, with qualifiers and positions', () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'total', targetPath: 'SG48/MOA+77/C516/5004' },
      { sourcePath: 'currency', targetPath: 'SG7/CUX/C504/6345' },
      { sourcePath: 'supplier.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
      { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
      { sourcePath: 'invoiceDateFormat', targetPath: 'DTM+137/C507/2379' },
      { sourcePath: 'invoiceDate', targetPath: 'DTM+137/C507/2380' },
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'documentType', targetPath: 'BGM/C002/1001' },
    ])

    const document = {
      invoiceNumber: 'INV-2026-0042',
      documentType: '380',
      invoiceDate: '20261014',
      invoiceDateFormat: '102',
      buyer: { gln: '4012345000009', name: 'Retail GmbH' },
      supplier: { gln: '4000001000005' },
      currency: 'EUR',
      total: '119.00',
    }

    expect(apply(version, document)).toEqual({
      header: { tag: 'UNH', elements: [['1'], ['INVOIC', 'D', '96A', 'UN', 'EAN008']] },
      segments: [
        { tag: 'BGM', elements: [['380'], ['INV-2026-0042']] },
        { tag: 'DTM', elements: [['137', '20261014', '102']] },
        { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
        { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
        { tag: 'CUX', elements: [['2', 'EUR', '4']] },
        { tag: 'UNS', elements: [['S']] },
        { tag: 'MOA', elements: [['77', '119.00']] },
      ],
      trailer: { tag: 'UNT', elements: [['9'], ['1']] },
    })
  })

  it.each([
    ['its source value is missing', orderHeader],
    [
      'nothing links to it',
      orderHeader.filter(({ targetPath }) => targetPath !== 'SG2+BY/NAD+BY/C082/3039'),
    ],
  ])('fails naming the buyer GLN when %s', (_, links) => {
    const version = outboundVersion('ORDERS', [
      ...links,
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    const error = failure(version, {
      ...order,
      buyer: { name: 'Retail GmbH' },
      line: { gtin: '4000862141404', quantity: 12 },
    })

    expect(error).toBeInstanceOf(MappingError)
    expect(error).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG2+BY/NAD+BY/C082/3039',
    })
  })

  it('fails naming the target element when a required source value is missing', () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    expect(failure(version, { ...order, line: { gtin: '4000862141404' } })).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('leaves out an optional segment group whose source values are all missing', () => {
    const version = outboundVersion('DESADV', [
      ...despatchHeader,
      { sourcePath: 'sscc', targetPath: 'SG10/SG11/SG13/SG15/GIN+BJ/C208/7402' },
    ])

    expect(apply(version, despatch)).toEqual({
      header: { tag: 'UNH', elements: [['1'], ['DESADV', 'D', '96A', 'UN', 'EAN005']] },
      segments: [
        { tag: 'BGM', elements: [['351'], ['DES-0815']] },
        { tag: 'DTM', elements: [['137', '20261015', '102']] },
        { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
        { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
        { tag: 'NAD', elements: [['DP'], ['4012345000016', '', '9']] },
        { tag: 'CPS', elements: [['1']] },
      ],
      trailer: { tag: 'UNT', elements: [['8'], ['1']] },
    })
  })

  it('fails when an optional segment group is filled but misses a required value', () => {
    const version = outboundVersion('DESADV', [
      ...despatchHeader,
      { sourcePath: 'gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
      { sourcePath: 'quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
    ])

    expect(failure(version, { ...despatch, gtin: '4000862141404', quantity: '' })).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG10/SG17/QTY+12/C186/6060',
    })
  })

  it('fails naming a target that is no element of the Message Type', () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'orderNumber', targetPath: 'SG1+ON/RFF+ON' },
    ])

    expect(failure(version, { invoiceNumber: 'INV-1', orderNumber: 'PO-4711' })).toMatchObject({
      code: 'unknownTarget',
      targetPath: 'SG1+ON/RFF+ON',
    })
  })

  it('fails naming a link into the message header, which the engine writes itself', () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'reference', targetPath: 'UNH/0062' },
    ])

    expect(failure(version, { ...order, reference: '4711' })).toMatchObject({
      code: 'unknownTarget',
      targetPath: 'UNH/0062',
    })
  })

  it('writes a number from the Document as it reads in JSON', () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'line.number', targetPath: 'SG25/LIN/1082' },
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    const document = { ...order, line: { number: 1, gtin: '4000862141404', quantity: 12.5 } }

    expect(apply(version, document).segments).toEqual([
      { tag: 'BGM', elements: [['220'], ['PO-4711']] },
      { tag: 'DTM', elements: [['137', '20261014', '102']] },
      { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
      { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12.5']] },
      { tag: 'UNS', elements: [['S']] },
    ])
  })

  it('repeats the line item group once per line, numbering the lines with the counter', () => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

    const document = {
      ...order,
      lines: [
        { gtin: '4000862141404', quantity: 12 },
        { gtin: '4000862141411', quantity: 5 },
      ],
    }

    expect(apply(version, document)).toEqual({
      header: { tag: 'UNH', elements: [['1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
      segments: [
        { tag: 'BGM', elements: [['220'], ['PO-4711']] },
        { tag: 'DTM', elements: [['137', '20261014', '102']] },
        { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
        { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
        { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
        { tag: 'QTY', elements: [['21', '12']] },
        { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
        { tag: 'QTY', elements: [['21', '5']] },
        { tag: 'UNS', elements: [['S']] },
      ],
      trailer: { tag: 'UNT', elements: [['11'], ['1']] },
    })
  })

  it('repeats a header field linked beneath the loop in every line', () => {
    const version = outboundVersion(
      'ORDERS',
      [
        ...orderHeader,
        ...orderLines,
        { sourcePath: 'deliveryDate', targetPath: 'SG25/DTM+2/C507/2380' },
        { sourcePath: 'dateFormat', targetPath: 'SG25/DTM+2/C507/2379' },
      ],
      orderLoop,
    )

    const document = {
      ...order,
      deliveryDate: '20261020',
      lines: [
        { gtin: '4000862141404', quantity: 12 },
        { gtin: '4000862141411', quantity: 5 },
      ],
    }

    expect(apply(version, document).segments.slice(4, -1)).toEqual([
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'DTM', elements: [['2', '20261020', '102']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['21', '5']] },
      { tag: 'DTM', elements: [['2', '20261020', '102']] },
    ])
  })

  it('fails naming the target element when one line misses a required value', () => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

    const document = {
      ...order,
      lines: [{ gtin: '4000862141404', quantity: 12 }, { gtin: '4000862141411' }],
    }

    expect(failure(version, document)).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it.each([
    ['an empty list', { ...order, lines: [] }],
    ['no list', order],
  ])('fails naming the line quantity when the required line item group gets %s', (_, document) => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

    expect(failure(version, document)).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('fails naming the line quantity when the required line item group gets no lines, though header fields fill it', () => {
    const version = outboundVersion(
      'ORDERS',
      [
        ...orderHeader,
        { sourcePath: 'gtin', targetPath: 'SG25/LIN/C212/7140' },
        { sourcePath: 'quantity', targetPath: 'SG25/QTY+21/C186/6060' },
      ],
      orderLoop,
    )

    const document = { ...order, gtin: '4000862141404', quantity: 12, lines: [] }

    expect(failure(version, document)).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('repeats an optional line item group inside its enclosing group, and leaves it out without lines', () => {
    const version = outboundVersion(
      'DESADV',
      [
        ...despatchHeader,
        { sourcePath: 'lines[].gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
        { sourcePath: 'lines[].quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
      ],
      { transforms: [loop], transformLinks: looped('lines[]', 'SG10/SG17', 'SG10/SG17/LIN/1082') },
    )

    const lines = [
      { gtin: '4000862141404', quantity: 12 },
      { gtin: '4000862141411', quantity: 5 },
    ]

    expect(apply(version, { ...despatch, lines }).segments.slice(5)).toEqual([
      { tag: 'CPS', elements: [['1']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['12', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['12', '5']] },
    ])
    expect(apply(version, { ...despatch, lines: [] }).segments.slice(5)).toEqual([
      { tag: 'CPS', elements: [['1']] },
    ])
  })

  it('reads the lines of the current package and numbers them across the whole message', () => {
    const version = outboundVersion(
      'DESADV',
      [
        ...despatchHeader.filter(({ targetPath }) => targetPath !== 'SG10/CPS/7164'),
        { sourcePath: 'packages[].lines[].gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
        { sourcePath: 'packages[].lines[].quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
      ],
      {
        transforms: [loopOf(packageLoopId), loop],
        transformLinks: [
          ...looped('packages[]', 'SG10', 'SG10/CPS/7164', packageLoopId),
          ...looped('packages[].lines[]', 'SG10/SG17', 'SG10/SG17/LIN/1082'),
        ],
      },
    )

    const document = {
      ...despatch,
      packages: [
        {
          lines: [
            { gtin: '4000862141404', quantity: 12 },
            { gtin: '4000862141411', quantity: 5 },
          ],
        },
        { lines: [{ gtin: '4000862141428', quantity: 7 }] },
      ],
    }

    const message = apply(version, document)

    expect(message.segments.slice(5)).toEqual([
      { tag: 'CPS', elements: [['1']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['12', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['12', '5']] },
      { tag: 'CPS', elements: [['2']] },
      { tag: 'LIN', elements: [['3'], [''], ['4000862141428', 'EN']] },
      { tag: 'QTY', elements: [['12', '7']] },
    ])
    expect(message.trailer).toEqual({ tag: 'UNT', elements: [['15'], ['1']] })
  })

  it.each<[string, MessageType, MappingLink[], Parameters<typeof outboundVersion>[2], string]>([
    [
      'no loop repeats the line item group',
      'ORDERS',
      [...orderHeader, ...orderLines],
      {},
      'SG25/LIN/C212/7140',
    ],
    [
      'it fills a header field',
      'ORDERS',
      [
        ...orderHeader.filter(({ targetPath }) => targetPath !== 'BGM/1004'),
        { sourcePath: 'lines[].gtin', targetPath: 'BGM/1004' },
        ...orderLines,
      ],
      orderLoop,
      'BGM/1004',
    ],
    [
      'only the line loop encloses it, not one over the packages',
      'DESADV',
      [
        ...despatchHeader,
        { sourcePath: 'packages[].lines[].gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
        { sourcePath: 'packages[].lines[].quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
      ],
      { transforms: [loop], transformLinks: looped('packages[].lines[]', 'SG10/SG17') },
      'SG10/SG17/LIN/C212/7140',
    ],
  ])(
    'fails naming a target that reads a repeating part when %s',
    (_, messageType, links, loops, target) => {
      const version = outboundVersion(messageType, links, loops)

      const document = {
        ...order,
        ...despatch,
        lines: [{ gtin: '4000862141404', quantity: 12 }],
        packages: [{ lines: [{ gtin: '4000862141404', quantity: 12 }] }],
      }

      expect(failure(version, document)).toMatchObject({ code: 'outsideLoop', targetPath: target })
    },
  )

  it.each([
    ['the loop items into an element', 'SG25/LIN/1082', 'SG25/LIN/1082', 'SG25/LIN/1082'],
    ['the loop items into a segment group the message type lacks', 'SG99', 'SG25/LIN/1082', 'SG99'],
    ['the counter into a segment group', 'SG25', 'SG25', 'SG25'],
    ['the counter into the message header', 'SG25', 'UNH/0062', 'UNH/0062'],
  ])('fails naming a target when a mapping links %s', (_, targetPart, counterTarget, unknown) => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], {
      transforms: [loop],
      transformLinks: looped('lines[]', targetPart, counterTarget),
    })

    const document = { ...order, lines: [{ gtin: '4000862141404', quantity: 12 }] }

    expect(failure(version, document)).toMatchObject({
      code: 'unknownTarget',
      targetPath: unknown,
    })
  })

  it('writes a constant into its target element', () => {
    const version = orderVia({ kind: 'constant', config: { value: 'PO-0001' } }, [
      intoTarget('BGM/1004'),
    ])

    expect(orderNumberOf(version)).toEqual({ tag: 'BGM', elements: [['220'], ['PO-0001']] })
  })

  const missingTransformId = '0f1e2d3c-4b5a-4968-8776-5544332211aa'

  it.each<[string, Pick<MappingTransform, 'kind' | 'config'>, TransformLink, string, string]>([
    [
      'its config is incomplete',
      { kind: 'constant', config: { value: '' } },
      intoTarget('BGM/1004'),
      'BGM/1004',
      transformId,
    ],
    [
      'an input is unconnected',
      { kind: 'substring', config: { start: 0, length: 4 } },
      intoTarget('BGM/1004'),
      'BGM/1004',
      transformId,
    ],
    [
      'a link starts at a transform the mapping lacks',
      { kind: 'constant', config: { value: 'PO-0001' } },
      intoTarget('BGM/1004', missingTransformId),
      'BGM/1004',
      missingTransformId,
    ],
  ])(
    'fails naming the target element and the transform when %s',
    (_, transform, link, targetPath, failedId) => {
      const version = orderVia(transform, [link])

      expect(failure(version, orderWithLine)).toMatchObject({
        code: 'invalidTransform',
        targetPath,
        transformId: failedId,
      })
    },
  )

  it.each([
    ['joins its parts with the separator', { prefix: 'PO', number: '4711' }, 'PO-4711'],
    ['leaves out an empty part with its separator', { prefix: 'PO', number: '' }, 'PO'],
  ])('concatenate %s', (_, fields, expected) => {
    const version = orderVia({ kind: 'concatenate', config: { inputCount: 2, separator: '-' } }, [
      fromSource('prefix', 'part1'),
      fromSource('number', 'part2'),
      intoTarget('BGM/1004'),
    ])

    expect(orderNumberOf(version, { ...orderWithLine, ...fields })).toEqual({
      tag: 'BGM',
      elements: [['220'], [expected]],
    })
  })

  it('split takes the part at its index from the value of each line', () => {
    const version = orderVia({ kind: 'split', config: { separator: '/', index: 0 } }, [
      fromSource('lines[].sku'),
      intoTarget('SG25/PIA+1/C212/7140'),
    ])

    const document = {
      ...order,
      lines: [
        { gtin: '4000862141404', quantity: 12, sku: 'ART-100/EA' },
        { gtin: '4000862141411', quantity: 5, sku: 'ART-200/KG' },
      ],
    }

    expect(apply(version, document).segments.slice(4, -1)).toEqual([
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'PIA', elements: [['1'], ['ART-100']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'PIA', elements: [['1'], ['ART-200']] },
      { tag: 'QTY', elements: [['21', '5']] },
    ])
  })

  it.each([
    ['the second part', 1, [['220'], ['4711']]],
    ['nothing when the value has fewer parts than its index', 2, [['220']]],
  ])('split takes %s', (_, index, elements) => {
    const version = orderVia({ kind: 'split', config: { separator: '/', index } }, [
      fromSource('reference'),
      intoTarget('BGM/1004'),
    ])

    expect(orderNumberOf(version, { ...orderWithLine, reference: 'PO/4711' })).toEqual({
      tag: 'BGM',
      elements,
    })
  })

  it.each([
    ['the rest from its start without a length', 6, null, [['220'], ['PO-4711']]],
    ['as many characters as its length', 6, 2, [['220'], ['PO']]],
    ['what remains when the length runs past the end', 9, 10, [['220'], ['4711']]],
    ['nothing when the start lies past the end', 20, null, [['220']]],
  ])('substring takes %s', (_, start, length, elements) => {
    const version = orderVia({ kind: 'substring', config: { start, length } }, [
      fromSource('reference'),
      intoTarget('BGM/1004'),
    ])

    expect(orderNumberOf(version, { ...orderWithLine, reference: 'ORDER-PO-4711' })).toEqual({
      tag: 'BGM',
      elements,
    })
  })

  it('fails naming a target that reads a line field through a transform outside its loop', () => {
    const version = orderVia({ kind: 'split', config: { separator: '/', index: 0 } }, [
      fromSource('lines[].sku'),
      intoTarget('BGM/1004'),
    ])

    const document = { ...order, lines: [{ gtin: '4000862141404', quantity: 12, sku: 'A/B' }] }

    expect(failure(version, document)).toMatchObject({
      code: 'outsideLoop',
      targetPath: 'BGM/1004',
    })
  })

  it('fails naming the target element when transforms feed each other in a circle', () => {
    const otherId = '6e7f8091-2b3c-4d4e-9f50-6b7c8d9e0f1a'
    const concatenate = { kind: 'concatenate', config: { inputCount: 2, separator: '' } } as const

    const version = outboundVersion('ORDERS', [...orderWithoutNumber, ...orderLines], {
      transforms: [loop, transformOf(transformId, concatenate), transformOf(otherId, concatenate)],
      transformLinks: [
        ...looped('lines[]', 'SG25', 'SG25/LIN/1082'),
        fromSource('prefix', 'part1'),
        {
          from: { kind: 'transform', transformId: otherId, output: 'value' },
          to: { kind: 'transform', transformId, input: 'part2' },
        },
        fromSource('prefix', 'part1', otherId),
        {
          from: { kind: 'transform', transformId, output: 'value' },
          to: { kind: 'transform', transformId: otherId, input: 'part2' },
        },
        intoTarget('BGM/1004'),
      ],
    })

    expect(failure(version, { ...orderWithLine, prefix: 'PO' })).toMatchObject({
      code: 'invalidTransform',
      targetPath: 'BGM/1004',
      transformId,
    })
  })
})
