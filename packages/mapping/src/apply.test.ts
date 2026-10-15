import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { JsonContent, MappingLink, MessageType } from '@edi-bridge/contracts'

import { applyMappingVersion, MappingError, type OutboundMappingVersion } from './index'

function outboundVersion(messageType: MessageType, links: MappingLink[]): OutboundMappingVersion {
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
    transforms: [],
    transformLinks: [],
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
})
