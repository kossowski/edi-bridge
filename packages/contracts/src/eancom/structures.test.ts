import { describe, expect, it } from 'vitest'

import { messageTypes } from '../message-type'
import { messageTypeStructures } from './structures'

import type { EdifactStructureNode } from '../edifact'

type AnyNode = { path: string; children?: ReadonlyArray<AnyNode> }

function flatten(nodes: ReadonlyArray<AnyNode>): AnyNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])])
}

function nodeAt(nodes: ReadonlyArray<EdifactStructureNode>, path: string) {
  return flatten(nodes).find((node) => node.path === path)
}

describe('messageTypeStructures', () => {
  it('explains the qualified segments of an ORDERS Message', () => {
    const { children, name } = messageTypeStructures.ORDERS

    expect(name).toEqual({ en: 'Purchase order', de: 'Bestellung' })
    expect(nodeAt(children, 'DTM+137')).toMatchObject({
      tag: 'DTM',
      name: { en: 'Date/time/period' },
      qualifier: { code: '137', meaning: { en: 'Document/message date/time' } },
    })
    expect(nodeAt(children, 'SG2+BY/NAD+BY')).toMatchObject({
      qualifier: { meaning: { en: 'Buyer', de: 'Käufer' } },
    })
    expect(nodeAt(children, 'SG2+SU/NAD+SU')).toMatchObject({
      qualifier: { meaning: { en: 'Supplier', de: 'Lieferant' } },
    })
    expect(nodeAt(children, 'SG25/QTY+21')).toMatchObject({
      qualifier: { meaning: { en: 'Ordered quantity', de: 'Bestellte Menge' } },
    })
  })

  it('explains the elements, including their codes', () => {
    const { children } = messageTypeStructures.ORDERS

    expect(nodeAt(children, 'SG2+BY/NAD+BY/C082/3039')).toMatchObject({
      kind: 'element',
      name: { en: 'Party id. identification' },
      format: 'an..35',
    })
    expect(nodeAt(children, 'BGM/C002/1001')).toMatchObject({
      codes: [{ code: '220', meaning: { en: 'Order', de: 'Bestellung' } }],
    })
  })

  it('marks the line item group as repeating', () => {
    expect(nodeAt(messageTypeStructures.ORDERS.children, 'SG25')).toMatchObject({
      kind: 'segmentGroup',
      required: true,
      maxRepeat: 9999,
    })
  })

  it.each([
    ['DESADV', 'Despatch advice', 'DTM+11', 'Despatch date and/or time'],
    ['INVOIC', 'Invoice', 'SG25/QTY+47', 'Invoiced quantity'],
    ['CONTRL', 'Syntax and service report', 'UCI', null],
  ] as const)('describes the %s structure', (messageType, name, path, meaning) => {
    const structure = messageTypeStructures[messageType]

    expect(structure.name.en).toBe(name)
    expect(nodeAt(structure.children, path)).toBeDefined()

    if (meaning) {
      expect(nodeAt(structure.children, path)).toMatchObject({
        qualifier: { meaning: { en: meaning } },
      })
    }
  })

  it.each([
    ['ORDERS', 'SG2+BY/NAD+BY/C082'],
    ['DESADV', 'SG2+DP/NAD+DP/C082'],
    ['INVOIC', 'SG2+SU/NAD+SU/C082'],
    ['ORDERS', 'SG25/LIN/C212'],
    ['DESADV', 'SG10/SG17/LIN/C212'],
    ['INVOIC', 'SG25/LIN/C212'],
    ['ORDERS', 'SG25/SG28/PRI+AAA/C509'],
    ['INVOIC', 'SG25/SG28/PRI+AAA/C509'],
    ['ORDERS', 'SG1+CT/RFF+CT/C506'],
    ['DESADV', 'DTM+137/C507'],
    ['INVOIC', 'SG25/QTY+47/C186'],
    ['INVOIC', 'SG48/MOA+77/C516'],
  ] as const)('requires %s %s in use', (messageType, path) => {
    expect(nodeAt(messageTypeStructures[messageType].children, path)).toMatchObject({
      kind: 'composite',
      required: true,
    })
  })

  it.each([
    ['ORDERS', [{ code: 'EAN008' }]],
    ['DESADV', [{ code: 'EAN005' }]],
    ['INVOIC', [{ code: 'EAN008' }]],
    ['CONTRL', []],
  ] as const)('gives the %s header its association assigned code', (messageType, codes) => {
    expect(nodeAt(messageTypeStructures[messageType].children, 'UNH/S009/0057')).toMatchObject({
      codes,
    })
  })

  it.each([
    ['ORDERS', 'SG25/IMD+A', ['7077', '7081', 'C273']],
    ['DESADV', 'SG10/SG17/IMD+A', ['7077', '7081', 'C273']],
    ['INVOIC', 'SG25/IMD+A', ['7077', '7081', 'C273']],
    ['INVOIC', 'SG25/IMD+A/C273', ['7009', '1131', '3055', '7008']],
    ['INVOIC', 'SG25/SG33/TAX+7', ['5283', 'C241', 'C533', '5286', 'C243', '5305']],
    ['INVOIC', 'SG50/TAX+7', ['5283', 'C241', 'C533', '5286', 'C243', '5305']],
    ['INVOIC', 'SG50/TAX+7/C243', ['5279', '1131', '3055', '5278']],
  ] as const)(
    'places the parts of %s %s at their UN D.96A positions',
    (messageType, path, codes) => {
      expect(
        nodeAt(messageTypeStructures[messageType].children, path)?.children?.map((child) =>
          child.path.split('/').at(-1),
        ),
      ).toEqual(codes)
    },
  )

  it.each(['SG25/IMD+A/C273/3055', 'SG25/SG33/TAX+7/C243/3055', 'SG50/TAX+7/C533/3055'])(
    'leaves the code list agency of INVOIC %s unfilled',
    (path) => {
      expect(nodeAt(messageTypeStructures.INVOIC.children, path)).toMatchObject({ codes: [] })
    },
  )

  it.each(messageTypes)('gives every node of %s a unique path', (messageType) => {
    const paths = flatten(messageTypeStructures[messageType].children).map(({ path }) => path)

    expect(new Set(paths).size).toBe(paths.length)
  })
})
