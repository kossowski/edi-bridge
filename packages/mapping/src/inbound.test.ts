import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  DocumentFieldType,
  DocumentStructure,
  DocumentStructureNode,
  MappingLink,
} from '@edi-bridge/contracts'
import type { Message, Segment } from '@edi-bridge/edifact'

import { applyInboundMappingVersion, type InboundMappingVersion, MappingError } from './index'

const documentStructureId = '5c2a8f61-1b3d-4e7a-9c0f-8d6e5b4a3f21'

function inboundVersion(links: MappingLink[]): InboundMappingVersion {
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
    transforms: [],
    transformLinks: [],
  }
}

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
})
