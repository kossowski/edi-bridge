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

  it.each(messageTypes)('gives every node of %s a unique path', (messageType) => {
    const paths = flatten(messageTypeStructures[messageType].children).map(({ path }) => path)

    expect(new Set(paths).size).toBe(paths.length)
  })
})
