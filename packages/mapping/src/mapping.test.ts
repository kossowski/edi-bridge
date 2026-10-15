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

describe('applyMappingVersion', () => {
  it('places plain links in the order of the Message Type, with qualifiers and positions', () => {
    const version = outboundVersion('INVOIC', [
      { sourcePath: 'currency', targetPath: 'SG7/CUX/C504/6345' },
      { sourcePath: 'buyer.gln', targetPath: 'SG2+BY/NAD+BY/C082/3039' },
      { sourcePath: 'invoiceDate', targetPath: 'DTM+137/C507/2380' },
      { sourcePath: 'invoiceNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'documentType', targetPath: 'BGM/C002/1001' },
    ])

    const document = {
      invoiceNumber: 'INV-2026-0042',
      documentType: '380',
      invoiceDate: '20261014',
      buyer: { gln: '4012345000009', name: 'Retail GmbH' },
      currency: 'EUR',
    }

    expect(apply(version, document)).toEqual({
      header: { tag: 'UNH', elements: [['1'], ['INVOIC', 'D', '96A', 'UN', 'EAN008']] },
      segments: [
        { tag: 'BGM', elements: [['380'], ['INV-2026-0042']] },
        { tag: 'DTM', elements: [['137', '20261014']] },
        { tag: 'NAD', elements: [['BY'], ['4012345000009', '', '9']] },
        { tag: 'CUX', elements: [['2', 'EUR', '4']] },
        { tag: 'UNS', elements: [['S']] },
      ],
      trailer: { tag: 'UNT', elements: [['7'], ['1']] },
    })
  })

  it('fails naming the target element when a required source value is missing', () => {
    const version = outboundVersion('ORDERS', [
      { sourcePath: 'orderNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    const error = failure(version, { orderNumber: 'PO-4711' })

    expect(error).toBeInstanceOf(MappingError)
    expect(error).toMatchObject({
      code: 'missingRequiredValue',
      targetPath: 'SG25/QTY+21/C186/6060',
    })
  })

  it('leaves out an optional segment group whose source values are all missing', () => {
    const version = outboundVersion('DESADV', [
      { sourcePath: 'despatchNumber', targetPath: 'BGM/1004' },
      { sourcePath: 'sscc', targetPath: 'SG10/SG11/SG13/SG15/GIN+BJ/C208/7402' },
    ])

    expect(apply(version, { despatchNumber: 'DES-0815' })).toEqual({
      header: { tag: 'UNH', elements: [['1'], ['DESADV', 'D', '96A', 'UN', 'EAN005']] },
      segments: [{ tag: 'BGM', elements: [['351'], ['DES-0815']] }],
      trailer: { tag: 'UNT', elements: [['3'], ['1']] },
    })
  })

  it('fails when an optional segment group is filled but misses a required value', () => {
    const version = outboundVersion('DESADV', [
      { sourcePath: 'gtin', targetPath: 'SG10/SG17/LIN/C212/7140' },
      { sourcePath: 'quantity', targetPath: 'SG10/SG17/QTY+12/C186/6060' },
    ])

    expect(failure(version, { gtin: '4000862141404', quantity: '' })).toMatchObject({
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

  it('writes a number from the Document as it reads in JSON', () => {
    const version = outboundVersion('ORDERS', [
      { sourcePath: 'line.quantity', targetPath: 'SG25/QTY+21/C186/6060' },
    ])

    expect(apply(version, { line: { quantity: 12.5 } }).segments).toEqual([
      { tag: 'QTY', elements: [['21', '12.5']] },
      { tag: 'UNS', elements: [['S']] },
    ])
  })
})
