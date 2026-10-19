import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type ConditionOperator,
  defaultCsvSettings,
  inferDocumentStructure,
  type JsonContent,
  type MappingLink,
  type MappingTransform,
  type MessageType,
  toEncodedFile,
  type TransformLink,
} from '@edi-bridge/contracts'

import {
  applyMappingVersion,
  mapMessage,
  MappingError,
  type OutboundMappingVersion,
  readDocument,
} from './index'

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

type Options = Parameters<typeof applyMappingVersion>[2]

const apply = (version: OutboundMappingVersion, document: JsonContent, options?: Options) =>
  Effect.runPromise(applyMappingVersion(version, document, options))

const failure = (version: OutboundMappingVersion, document: JsonContent, options?: Options) =>
  Effect.runPromise(Effect.flip(applyMappingVersion(version, document, options)))

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

function orderVia(
  transform: Pick<MappingTransform, 'kind' | 'config'>,
  transformLinks: TransformLink[],
) {
  const replaced = transformLinks.flatMap(({ to }) => (to.kind === 'target' ? [to.path] : []))

  return outboundVersion(
    'ORDERS',
    [...orderHeader, ...orderLines].filter(({ targetPath }) => !replaced.includes(targetPath)),
    {
      transforms: [loop, transformOf(transformId, transform)],
      transformLinks: [...looped('lines[]', 'SG25', 'SG25/LIN/1082'), ...transformLinks],
    },
  )
}

const orderWithLine = { ...order, lines: [{ gtin: '4000862141404', quantity: 12 }] }

const orderNumberOf = async (
  version: OutboundMappingVersion,
  document: JsonContent = orderWithLine,
) => (await apply(version, document)).segments[0]

describe('applyMappingVersion', () => {
  it('places plain links in the order of the Message Type, with qualifiers and positions', async () => {
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

    expect(await apply(version, document)).toEqual({
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

  it('writes name and address, contact and free text at their UN D.96A positions', async () => {
    const version = outboundVersion(
      'ORDERS',
      [
        ...orderHeader,
        ...orderLines,
        { sourcePath: 'note', targetPath: 'FTX+AAI/C108/4440' },
        { sourcePath: 'buyer.name', targetPath: 'SG2+BY/NAD+BY/C080/3036' },
        { sourcePath: 'buyer.street', targetPath: 'SG2+BY/NAD+BY/C059/3042' },
        { sourcePath: 'buyer.city', targetPath: 'SG2+BY/NAD+BY/3164' },
        { sourcePath: 'buyer.postalCode', targetPath: 'SG2+BY/NAD+BY/3251' },
        { sourcePath: 'buyer.country', targetPath: 'SG2+BY/NAD+BY/3207' },
        { sourcePath: 'buyer.contact', targetPath: 'SG2+BY/SG5/CTA+OC/C056/3412' },
      ],
      orderLoop,
    )

    const document = {
      ...orderWithLine,
      note: 'Deliver to gate 3',
      buyer: {
        ...order.buyer,
        name: 'Retail GmbH',
        street: 'Hafenstr. 1',
        city: 'Hamburg',
        postalCode: '20457',
        country: 'DE',
        contact: 'Anna Meier',
      },
    }

    const { segments } = await apply(version, document)

    expect(segments.filter(({ tag }) => ['FTX', 'CTA'].includes(tag))).toEqual([
      { tag: 'FTX', elements: [['AAI'], [''], [''], ['Deliver to gate 3']] },
      { tag: 'CTA', elements: [['OC'], ['', 'Anna Meier']] },
    ])
    expect(segments.find(({ tag }) => tag === 'NAD')).toEqual({
      tag: 'NAD',
      elements: [
        ['BY'],
        ['4012345000009', '', '9'],
        [''],
        ['Retail GmbH'],
        ['Hafenstr. 1'],
        ['Hamburg'],
        [''],
        ['20457'],
        ['DE'],
      ],
    })
  })

  it('writes the package type of a DESADV at its UN D.96A position', async () => {
    const version = outboundVersion('DESADV', [
      ...despatchHeader,
      { sourcePath: 'packageCount', targetPath: 'SG10/SG11/PAC/7224' },
      { sourcePath: 'packageType', targetPath: 'SG10/SG11/PAC/C202/7065' },
    ])

    const { segments } = await apply(version, {
      ...despatch,
      packageCount: '3',
      packageType: 'PX',
    })

    expect(segments.find(({ tag }) => tag === 'PAC')).toEqual({
      tag: 'PAC',
      elements: [['3'], [''], ['PX']],
    })
  })

  it('writes the payment terms of an INVOIC at their UN D.96A positions', async () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
      { sourcePath: 'supplier.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'invoiceDate', targetPath: 'DTM+137/C507/2380' },
      { sourcePath: 'currency', targetPath: 'SG7/CUX/C504/6345' },
      { sourcePath: 'total', targetPath: 'SG48/MOA+77/C516/5004' },
      { sourcePath: 'paymentDays', targetPath: 'SG8/PAT+1/C112/2152' },
    ])

    const { segments } = await apply(version, {
      ...order,
      invoiceNumber: 'INV-2026-0042',
      invoiceDate: '20261014',
      currency: 'EUR',
      total: '119.00',
      paymentDays: '30',
    })

    expect(segments.find(({ tag }) => tag === 'PAT')).toEqual({
      tag: 'PAT',
      elements: [['1'], [''], ['5', '3', 'D', '30']],
    })
  })

  it.each([
    ['its source value is missing', orderHeader],
    [
      'nothing links to it',
      orderHeader.filter(({ targetPath }) => targetPath !== 'SG2+BY/NAD+BY/C082/3039'),
    ],
  ])('fails naming the buyer GLN when %s', async (_, links) => {
    const version = outboundVersion('ORDERS', [
      ...links,
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    const error = await failure(version, {
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

  it('fails naming the target element when a required source value is missing', async () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    expect(await failure(version, { ...order, line: { gtin: '4000862141404' } })).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('leaves out an optional segment group whose source values are all missing', async () => {
    const version = outboundVersion('DESADV', [
      ...despatchHeader,
      { sourcePath: 'sscc', targetPath: 'SG10/SG11/SG13/SG15/GIN+BJ/C208/7402' },
    ])

    expect(await apply(version, despatch)).toEqual({
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

  it('fails when an optional segment group is filled but misses a required value', async () => {
    const version = outboundVersion('DESADV', [
      ...despatchHeader,
      { sourcePath: 'gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
      { sourcePath: 'quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
    ])

    expect(
      await failure(version, { ...despatch, gtin: '4000862141404', quantity: '' }),
    ).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG10/SG17/QTY+12/C186/6060',
    })
  })

  it('fails naming a target that is no element of the Message Type', async () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'orderNumber', targetPath: 'SG1+ON/RFF+ON' },
    ])

    expect(
      await failure(version, { invoiceNumber: 'INV-1', orderNumber: 'PO-4711' }),
    ).toMatchObject({
      code: 'unknownTarget',
      targetPath: 'SG1+ON/RFF+ON',
    })
  })

  it('fails naming a link into the message header, which the engine writes itself', async () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'reference', targetPath: 'UNH/0062' },
    ])

    expect(await failure(version, { ...order, reference: '4711' })).toMatchObject({
      code: 'unknownTarget',
      targetPath: 'UNH/0062',
    })
  })

  it('writes a number from the Document as it reads in JSON', async () => {
    const version = outboundVersion('ORDERS', [
      ...orderHeader,
      { sourcePath: 'line.number', targetPath: 'SG25/LIN/1082' },
      { sourcePath: 'line.gtin', targetPath: 'SG25/LIN/C212/7140' },
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    const document = { ...order, line: { number: 1, gtin: '4000862141404', quantity: 12.5 } }

    expect((await apply(version, document)).segments).toEqual([
      { tag: 'BGM', elements: [['220'], ['PO-4711']] },
      { tag: 'DTM', elements: [['137', '20261014', '102']] },
      { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
      { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12.5']] },
      { tag: 'UNS', elements: [['S']] },
    ])
  })

  it('repeats the line item group once per line, numbering the lines with the counter', async () => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

    const document = {
      ...order,
      lines: [
        { gtin: '4000862141404', quantity: 12 },
        { gtin: '4000862141411', quantity: 5 },
      ],
    }

    expect(await apply(version, document)).toEqual({
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

  it('repeats a header field linked beneath the loop in every line', async () => {
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

    expect((await apply(version, document)).segments.slice(4, -1)).toEqual([
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'DTM', elements: [['2', '20261020', '102']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['21', '5']] },
      { tag: 'DTM', elements: [['2', '20261020', '102']] },
    ])
  })

  it('fails naming the target element when one line misses a required value', async () => {
    const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

    const document = {
      ...order,
      lines: [{ gtin: '4000862141404', quantity: 12 }, { gtin: '4000862141411' }],
    }

    expect(await failure(version, document)).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it.each([
    ['an empty list', { ...order, lines: [] }],
    ['no list', order],
  ])(
    'fails naming the line quantity when the required line item group gets %s',
    async (_, document) => {
      const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], orderLoop)

      expect(await failure(version, document)).toMatchObject({
        code: 'missingRequiredValue',
        targetPath: 'SG25/QTY+21/C186/6060',
      })
    },
  )

  it('fails naming the line quantity when the required line item group gets no lines, though header fields fill it', async () => {
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

    expect(await failure(version, document)).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('repeats an optional line item group inside its enclosing group, and leaves it out without lines', async () => {
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

    expect((await apply(version, { ...despatch, lines })).segments.slice(5)).toEqual([
      { tag: 'CPS', elements: [['1']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['12', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['12', '5']] },
    ])
    expect((await apply(version, { ...despatch, lines: [] })).segments.slice(5)).toEqual([
      { tag: 'CPS', elements: [['1']] },
    ])
  })

  it('reads the lines of the current package and numbers them across the whole message', async () => {
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

    const message = await apply(version, document)

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
    async (_, messageType, links, loops, target) => {
      const version = outboundVersion(messageType, links, loops)

      const document = {
        ...order,
        ...despatch,
        lines: [{ gtin: '4000862141404', quantity: 12 }],
        packages: [{ lines: [{ gtin: '4000862141404', quantity: 12 }] }],
      }

      expect(await failure(version, document)).toMatchObject({
        code: 'outsideLoop',
        targetPath: target,
      })
    },
  )

  it.each([
    ['the loop items into an element', 'SG25/LIN/1082', 'SG25/LIN/1082', 'SG25/LIN/1082'],
    ['the loop items into a segment group the message type lacks', 'SG99', 'SG25/LIN/1082', 'SG99'],
    ['the counter into a segment group', 'SG25', 'SG25', 'SG25'],
    ['the counter into the message header', 'SG25', 'UNH/0062', 'UNH/0062'],
  ])(
    'fails naming a target when a mapping links %s',
    async (_, targetPart, counterTarget, unknown) => {
      const version = outboundVersion('ORDERS', [...orderHeader, ...orderLines], {
        transforms: [loop],
        transformLinks: looped('lines[]', targetPart, counterTarget),
      })

      const document = { ...order, lines: [{ gtin: '4000862141404', quantity: 12 }] }

      expect(await failure(version, document)).toMatchObject({
        code: 'unknownTarget',
        targetPath: unknown,
      })
    },
  )

  it('writes a constant into its target element', async () => {
    const version = orderVia({ kind: 'constant', config: { value: 'PO-0001' } }, [
      intoTarget('BGM/1004'),
    ])

    expect(await orderNumberOf(version)).toEqual({ tag: 'BGM', elements: [['220'], ['PO-0001']] })
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
      'its expression does not parse',
      { kind: 'jsonata', config: { expression: "orderNumber & '-'  &" } },
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
    async (_, transform, link, targetPath, failedId) => {
      const version = orderVia(transform, [link])

      expect(await failure(version, orderWithLine)).toMatchObject({
        code: 'invalidTransform',
        targetPath,
        transformId: failedId,
      })
    },
  )

  it.each([
    ['joins its parts with the separator', { prefix: 'PO', number: '4711' }, 'PO-4711'],
    ['leaves out an empty part with its separator', { prefix: 'PO', number: '' }, 'PO'],
  ])('concatenate %s', async (_, fields, expected) => {
    const version = orderVia({ kind: 'concatenate', config: { inputCount: 2, separator: '-' } }, [
      fromSource('prefix', 'part1'),
      fromSource('number', 'part2'),
      intoTarget('BGM/1004'),
    ])

    expect(await orderNumberOf(version, { ...orderWithLine, ...fields })).toEqual({
      tag: 'BGM',
      elements: [['220'], [expected]],
    })
  })

  it('split takes the part at its index from the value of each line', async () => {
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

    expect((await apply(version, document)).segments.slice(4, -1)).toEqual([
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
  ])('split takes %s', async (_, index, elements) => {
    const version = orderVia({ kind: 'split', config: { separator: '/', index } }, [
      fromSource('reference'),
      intoTarget('BGM/1004'),
    ])

    expect(await orderNumberOf(version, { ...orderWithLine, reference: 'PO/4711' })).toEqual({
      tag: 'BGM',
      elements,
    })
  })

  it.each([
    ['the rest from its start without a length', 6, null, [['220'], ['PO-4711']]],
    ['as many characters as its length', 6, 2, [['220'], ['PO']]],
    ['what remains when the length runs past the end', 9, 10, [['220'], ['4711']]],
    ['nothing when the start lies past the end', 20, null, [['220']]],
  ])('substring takes %s', async (_, start, length, elements) => {
    const version = orderVia({ kind: 'substring', config: { start, length } }, [
      fromSource('reference'),
      intoTarget('BGM/1004'),
    ])

    expect(await orderNumberOf(version, { ...orderWithLine, reference: 'ORDER-PO-4711' })).toEqual({
      tag: 'BGM',
      elements,
    })
  })

  it('fails naming a target that reads a line field through a transform outside its loop', async () => {
    const version = orderVia({ kind: 'split', config: { separator: '/', index: 0 } }, [
      fromSource('lines[].sku'),
      intoTarget('BGM/1004'),
    ])

    const document = { ...order, lines: [{ gtin: '4000862141404', quantity: 12, sku: 'A/B' }] }

    expect(await failure(version, document)).toMatchObject({
      code: 'outsideLoop',
      targetPath: 'BGM/1004',
    })
  })

  it('fails naming the target element when transforms feed each other in a circle', async () => {
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

    expect(await failure(version, { ...orderWithLine, prefix: 'PO' })).toMatchObject({
      code: 'invalidTransform',
      targetPath: 'BGM/1004',
      transformId,
    })
  })

  it.each([
    ['yyyy-MM-dd', 'yyyyMMdd', '2026-10-14', '20261014'],
    ['dd.MM.yy', 'yyyyMMdd', '14.10.26', '20261014'],
    ['yyyy-MM-ddTHH:mm:ss', 'yyyyMMddHHmm', '2026-10-14T09:30:00', '202610140930'],
    ['yyyyMMdd', 'yyyyMMddHHmm', '20261014', '202610140000'],
    ['yyyyMMdd', 'dd/MM/yyyy', '20240229', '29/02/2024'],
  ])('date format reads %s and writes %s', async (from, to, date, expected) => {
    const version = orderVia({ kind: 'dateFormat', config: { from, to } }, [
      fromSource('orderDate'),
      intoTarget('DTM+137/C507/2380'),
    ])

    expect((await apply(version, { ...orderWithLine, orderDate: date })).segments[1]).toEqual({
      tag: 'DTM',
      elements: [['137', expected, '102']],
    })
  })

  it('date format leaves an empty date empty', async () => {
    const version = orderVia(
      { kind: 'dateFormat', config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' } },
      [fromSource('orderDate'), intoTarget('DTM+137/C507/2380')],
    )

    expect((await apply(version, { ...orderWithLine, orderDate: '' })).segments[1]).toEqual({
      tag: 'DTM',
      elements: [['137', '', '102']],
    })
  })

  it.each([
    ['in another pattern', '14.10.2026'],
    ['with a day the month lacks', '2026-02-29'],
    ['with a month past December', '2026-13-01'],
    ['with characters after the pattern', '2026-10-14 09:30'],
  ])('date format fails naming the target element for a date %s', async (_, date) => {
    const version = orderVia(
      { kind: 'dateFormat', config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' } },
      [fromSource('orderDate'), intoTarget('DTM+137/C507/2380')],
    )

    expect(await failure(version, { ...orderWithLine, orderDate: date })).toMatchObject({
      code: 'invalidDate',
      targetPath: 'DTM+137/C507/2380',
      transformId,
    })
  })

  const pricing = (decimalPlaces: number | null, decimalSeparator: '.' | ',') =>
    orderVia({ kind: 'numberFormat', config: { decimalPlaces, decimalSeparator } }, [
      fromSource('lines[].price'),
      intoTarget('SG25/SG28/PRI+AAA/C509/5118'),
    ])

  const pricedLine = (price: JsonContent) => ({
    ...order,
    lines: [{ gtin: '4000862141404', quantity: 12, price }],
  })

  it.each<[number | null, '.' | ',', JsonContent, string]>([
    [2, ',', '12.5', '12,50'],
    [2, '.', '12,5', '12.50'],
    [2, '.', '1.005', '1.01'],
    [2, '.', '9.999', '10.00'],
    [0, '.', '2.5', '3'],
    [0, '.', '-2.5', '-3'],
    [1, '.', 19.99, '20.0'],
    [null, ',', '12.50', '12,50'],
    [null, ',', 7, '7'],
    [null, ',', 1e-7, '0,0000001'],
    [2, '.', 1e-7, '0.00'],
    [null, '.', -2.5e-8, '-0.000000025'],
    [2, ',', 1.5e21, '1500000000000000000000,00'],
  ])(
    'number format with %s decimal places and separator %s writes %s as %s',
    async (places, separator, price, expected) => {
      expect((await apply(pricing(places, separator), pricedLine(price))).segments.at(-2)).toEqual({
        tag: 'PRI',
        elements: [['AAA', expected]],
      })
    },
  )

  it.each(['1.234,50', 'twelve', '12.', ' 12', '1e-7'])(
    'number format fails naming the target element for %s',
    async (price) => {
      expect(await failure(pricing(2, '.'), pricedLine(price))).toMatchObject({
        code: 'invalidNumber',
        targetPath: 'SG25/SG28/PRI+AAA/C509/5118',
        transformId,
      })
    },
  )

  const unitTableId = '8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e'

  const lookupTables = new Map([
    [
      unitTableId,
      [
        { sourceCode: 'ST', targetCode: 'PCE' },
        { sourceCode: 'KG', targetCode: 'KGM' },
      ],
    ],
  ])

  const unitsVia = (fallback: 'keepValue' | 'empty' | 'fail') =>
    orderVia({ kind: 'lookupTable', config: { lookupTableId: unitTableId, fallback } }, [
      fromSource('lines[].unit'),
      intoTarget('SG25/QTY+21/C186/6411'),
    ])

  const unitLines = (...units: string[]) => ({
    ...order,
    lines: units.map((unit, index) => ({ gtin: `400086214140${index}`, quantity: 12, unit })),
  })

  const quantities = async (version: OutboundMappingVersion, document: JsonContent) =>
    (await apply(version, document, { lookupTables })).segments.filter(({ tag }) => tag === 'QTY')

  it('lookup table translates the code of each line', async () => {
    expect(await quantities(unitsVia('fail'), unitLines('ST', 'KG'))).toEqual([
      { tag: 'QTY', elements: [['21', '12', 'PCE']] },
      { tag: 'QTY', elements: [['21', '12', 'KGM']] },
    ])
  })

  it.each([
    ['keepValue', [['21', '12', 'PCE']]],
    ['empty', [['21', '12']]],
  ] as const)(
    'lookup table with the %s fallback handles a code it lacks',
    async (fallback, elements) => {
      expect(await quantities(unitsVia(fallback), unitLines('PCE'))).toEqual([
        { tag: 'QTY', elements },
      ])
    },
  )

  it('lookup table with the fail fallback fails naming the target element for a code it lacks', async () => {
    expect(await failure(unitsVia('fail'), unitLines('ST', 'PCE'), { lookupTables })).toMatchObject(
      {
        code: 'noLookupMatch',
        targetPath: 'SG25/QTY+21/C186/6411',
        transformId,
        lookup: { lookupTableId: unitTableId, code: 'PCE' },
      },
    )
  })

  it('lookup table fails naming the target element when the engine lacks its table', async () => {
    expect(await failure(unitsVia('keepValue'), unitLines('ST'))).toMatchObject({
      code: 'unknownLookupTable',
      targetPath: 'SG25/QTY+21/C186/6411',
      transformId,
    })
  })

  const conditionalVia = (operator: ConditionOperator, compareTo: string, links: TransformLink[]) =>
    orderVia({ kind: 'conditional', config: { operator, compareTo } }, [
      fromSource('orderType'),
      fromSource('rushNumber', 'then'),
      ...links,
      intoTarget('BGM/1004'),
    ])

  const rushOrder = (orderType: string) => ({
    ...orderWithLine,
    orderType,
    rushNumber: 'RUSH-1',
    orderNumber: 'PO-4711',
  })

  it.each<[ConditionOperator, string, string, string]>([
    ['equals', 'rush', 'rush', 'RUSH-1'],
    ['equals', 'rush', 'rushed', 'PO-4711'],
    ['notEquals', 'rush', 'normal', 'RUSH-1'],
    ['notEquals', 'rush', 'rush', 'PO-4711'],
    ['contains', 'rush', 'urgent-rush', 'RUSH-1'],
    ['contains', 'rush', 'Rush', 'PO-4711'],
    ['isEmpty', '', '', 'RUSH-1'],
    ['isEmpty', '', 'rush', 'PO-4711'],
    ['isNotEmpty', '', 'rush', 'RUSH-1'],
    ['isNotEmpty', '', '', 'PO-4711'],
  ])('conditional %s %j on %j writes %s', async (operator, compareTo, orderType, expected) => {
    const version = conditionalVia(operator, compareTo, [fromSource('orderNumber', 'else')])

    expect(await orderNumberOf(version, rushOrder(orderType))).toEqual({
      tag: 'BGM',
      elements: [['220'], [expected]],
    })
  })

  it('conditional leaves its target empty when the condition does not hold and it has no else', async () => {
    expect(await orderNumberOf(conditionalVia('equals', 'rush', []), rushOrder('normal'))).toEqual({
      tag: 'BGM',
      elements: [['220']],
    })
  })

  const branchId = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60'

  const conditionalBeside = (
    branch: 'then' | 'else',
    taken: TransformLink,
    failing: Pick<MappingTransform, 'kind' | 'config'>,
  ) =>
    outboundVersion('ORDERS', [...orderWithoutNumber, ...orderLines], {
      transforms: [
        loop,
        transformOf(transformId, {
          kind: 'conditional',
          config: { operator: 'equals', compareTo: 'rush' },
        }),
        transformOf(branchId, failing),
      ],
      transformLinks: [
        ...looped('lines[]', 'SG25', 'SG25/LIN/1082'),
        fromSource('orderType'),
        taken,
        fromSource('failingValue', 'value', branchId),
        {
          from: { kind: 'transform', transformId: branchId, output: 'value' },
          to: { kind: 'transform', transformId, input: branch },
        },
        intoTarget('BGM/1004'),
      ],
    })

  it('conditional leaves a failing else input alone when the condition holds', async () => {
    const version = conditionalBeside('else', fromSource('rushNumber', 'then'), {
      kind: 'lookupTable',
      config: { lookupTableId: unitTableId, fallback: 'fail' },
    })

    const document = { ...rushOrder('rush'), failingValue: 'XX' }

    expect((await apply(version, document, { lookupTables })).segments[0]).toEqual({
      tag: 'BGM',
      elements: [['220'], ['RUSH-1']],
    })
  })

  it('conditional leaves a failing then input alone when the condition does not hold', async () => {
    const version = conditionalBeside('then', fromSource('orderNumber', 'else'), {
      kind: 'dateFormat',
      config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' },
    })

    const document = { ...rushOrder('normal'), failingValue: '14.10.2026' }

    expect(await orderNumberOf(version, document)).toEqual({
      tag: 'BGM',
      elements: [['220'], ['PO-4711']],
    })
  })

  const expressionVia = (expression: string, target = 'BGM/1004') =>
    orderVia({ kind: 'jsonata', config: { expression } }, [intoTarget(target)])

  const twoLines = {
    ...order,
    lines: [
      { gtin: '4000862141404', quantity: 12 },
      { gtin: '4000862141411', quantity: 5 },
    ],
  }

  it.each([
    ['a text', "orderNumber & '/' & $string($count(lines))", [['220'], ['PO-4711/2']]],
    ['a number', '$sum(lines.quantity)', [['220'], ['17']]],
    ['nothing when it matches nothing', 'invoiceNumber', [['220']]],
  ])('JSONata writes %s', async (_, expression, elements) => {
    expect(await orderNumberOf(expressionVia(expression), twoLines)).toEqual({
      tag: 'BGM',
      elements,
    })
  })

  it('JSONata reads the whole Document beneath a loop too', async () => {
    const version = expressionVia('orderNumber', 'SG25/PIA+1/C212/7140')

    expect((await apply(version, twoLines)).segments.filter(({ tag }) => tag === 'PIA')).toEqual([
      { tag: 'PIA', elements: [['1'], ['PO-4711']] },
      { tag: 'PIA', elements: [['1'], ['PO-4711']] },
    ])
  })

  it('JSONata reads the whole Document once rather than each line', async () => {
    const version = expressionVia('$sum(lines.quantity)', 'SG25/PIA+1/C212/7140')

    expect((await apply(version, twoLines)).segments.filter(({ tag }) => tag === 'PIA')).toEqual([
      { tag: 'PIA', elements: [['1'], ['17']] },
      { tag: 'PIA', elements: [['1'], ['17']] },
    ])
  })

  const packedQuantityVia = (
    transform: Pick<MappingTransform, 'kind' | 'config'>,
    transformLinks: TransformLink[],
  ) =>
    outboundVersion(
      'DESADV',
      [...despatchHeader, { sourcePath: 'lines[].gtin', targetPath: 'SG10/SG17/LIN/C212/7140' }],
      {
        transforms: [loop, transformOf(transformId, transform)],
        transformLinks: [
          ...looped('lines[]', 'SG10/SG17', 'SG10/SG17/LIN/1082'),
          ...transformLinks,
          intoTarget('SG10/SG17/QTY+12/C186/6060'),
        ],
      },
    )

  it.each<[string, Pick<MappingTransform, 'kind' | 'config'>, TransformLink[], string]>([
    [
      'a lookup table the engine lacks',
      { kind: 'lookupTable', config: { lookupTableId: unitTableId, fallback: 'keepValue' } },
      [fromSource('lines[].quantity')],
      'unknownLookupTable',
    ],
    [
      'an expression that fails to evaluate',
      { kind: 'jsonata', config: { expression: "$number('twelve')" } },
      [],
      'expressionFailed',
    ],
  ])('fails for %s beneath a loop without lines', async (_, transform, transformLinks, code) => {
    expect(
      await failure(packedQuantityVia(transform, transformLinks), { ...despatch, lines: [] }),
    ).toMatchObject({ code, targetPath: 'SG10/SG17/QTY+12/C186/6060', transformId })
  })

  it.each([
    ['gives a list', 'lines.gtin'],
    ['gives an object', 'buyer'],
    ['fails to evaluate', "$number('twelve')"],
  ])('JSONata fails naming the target element when its expression %s', async (_, expression) => {
    expect(await failure(expressionVia(expression), twoLines)).toMatchObject({
      code: 'expressionFailed',
      targetPath: 'BGM/1004',
      transformId,
    })
  })

  const headerFields = [
    { id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c01', field: 'orderNumber', target: 'BGM/1004' },
    { id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c02', field: 'orderDate', target: 'DTM+137/C507/2380' },
    {
      id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c03',
      field: 'buyer',
      target: 'SG2+BY/NAD+BY/C082/3039',
    },
    {
      id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c04',
      field: 'supplier',
      target: 'SG2+SU/NAD+SU/C082/3039',
    },
  ]

  const rootListOrderVersion = (list: string) =>
    outboundVersion(
      'ORDERS',
      [
        { sourcePath: `${list}[].gtin`, targetPath: 'SG25/LIN/C212/7140' },
        { sourcePath: `${list}[].quantity`, targetPath: 'SG25/QTY+21/C186/6060' },
      ],
      {
        transforms: [
          loop,
          ...headerFields.map(({ id, field }) =>
            transformOf(id, { kind: 'jsonata', config: { expression: `${list}[0].${field}` } }),
          ),
        ],
        transformLinks: [
          ...looped(`${list}[]`, 'SG25', 'SG25/LIN/1082'),
          ...headerFields.map(({ id, target }) => intoTarget(target, id)),
        ],
      },
    )

  const rootListOrderMessage = {
    header: { tag: 'UNH', elements: [['1'], ['ORDERS', 'D', '96A', 'UN', 'EAN008']] },
    segments: [
      { tag: 'BGM', elements: [['220'], ['PO-4711']] },
      { tag: 'DTM', elements: [['137', '20261014']] },
      { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
      { tag: 'NAD', elements: [['SU'], ['4000001000005', '', '9']] },
      { tag: 'LIN', elements: [['1'], [''], ['4000862141404', 'EN']] },
      { tag: 'QTY', elements: [['21', '12']] },
      { tag: 'LIN', elements: [['2'], [''], ['4000862141411', 'EN']] },
      { tag: 'QTY', elements: [['21', '5']] },
      { tag: 'UNS', elements: [['S']] },
    ],
    trailer: { tag: 'UNT', elements: [['11'], ['1']] },
  }

  it('loops over the rows of a CSV Document, its header fields read from the first row', async () => {
    const csv = [
      'orderNumber;orderDate;buyer;supplier;gtin;quantity',
      'PO-4711;20261014;4012345000009;4000001000005;4000862141404;12',
      'PO-4711;20261014;4012345000009;4000001000005;4000862141411;5',
    ].join('\n')

    const structure = inferDocumentStructure({
      kind: 'csvDocument',
      document: toEncodedFile('order.csv', csv),
      csv: defaultCsvSettings,
    })

    const document = await Effect.runPromise(readDocument(structure, csv))

    expect(await apply(rootListOrderVersion('rows'), document)).toEqual(rootListOrderMessage)
  })

  it('loops over the items of a JSON Document whose root is a list', async () => {
    const orderHeader = {
      orderNumber: 'PO-4711',
      orderDate: '20261014',
      buyer: '4012345000009',
      supplier: '4000001000005',
    }

    const json = JSON.stringify([
      { ...orderHeader, gtin: '4000862141404', quantity: 12 },
      { ...orderHeader, gtin: '4000862141411', quantity: 5 },
    ])

    const structure = inferDocumentStructure({
      kind: 'jsonDocument',
      document: toEncodedFile('order.json', json),
    })

    const document = await Effect.runPromise(readDocument(structure, json))

    expect(await apply(rootListOrderVersion('items'), document)).toEqual(rootListOrderMessage)
  })
})

describe('mapMessage', () => {
  it('names the target path that wrote a position of the Message, counted from its UNH', async () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'invoiceDate', targetPath: 'DTM+137/C507/2380' },
      { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
      { sourcePath: 'supplier.gln', targetPath: 'SG2+SU/NAD+SU/C082/3039' },
      { sourcePath: 'total', targetPath: 'SG48/MOA+77/C516/5004' },
    ])

    const document = {
      invoiceNumber: 'INV-2026-0042',
      invoiceDate: '20261014',
      buyer: { gln: '4012345000009' },
      supplier: { gln: '4000001000005' },
      total: '119.00',
    }

    const { message, targetPathAt } = await Effect.runPromise(mapMessage(version, document))

    expect(message).toEqual(await apply(version, document))
    expect(
      [
        { segment: 2, element: 2 },
        { segment: 4, element: 2, component: 1 },
        { segment: 8, element: 1, component: 2 },
        { segment: 3, element: 1 },
        { segment: 2, element: 9 },
        { segment: 9 },
        { segment: 10 },
      ].map(targetPathAt),
    ).toEqual([
      'BGM/1004',
      'SG2+BY/NAD+BY/C082/3039',
      'SG48/MOA+77/C516/5004',
      'DTM+137/C507',
      'BGM',
      'UNT',
      undefined,
    ])
  })
})
