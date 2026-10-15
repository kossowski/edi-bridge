import { describe, expect, it } from 'vitest'

import { messageTypes } from '../message-type'
import { messageTypeStructures } from './structures'

import type { EdifactComposite, EdifactSegment, EdifactStructureNode } from '../edifact'

type AnyNode = { path: string; children?: ReadonlyArray<AnyNode> }

function flatten(nodes: ReadonlyArray<AnyNode>): AnyNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])])
}

function partsOf(
  nodes: ReadonlyArray<EdifactStructureNode>,
): Array<EdifactSegment | EdifactComposite> {
  return nodes.flatMap((node) =>
    node.kind === 'segmentGroup'
      ? partsOf(node.children)
      : [node, ...node.children.filter((child) => child.kind === 'composite')],
  )
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

  const layouts = new Map(
    Object.entries({
      BGM: ['C002', '1004', '1225'],
      CNT: ['C270'],
      COM: ['C076'],
      CPS: ['7164', '7166'],
      CTA: ['3139', 'C056'],
      CUX: ['C504'],
      DTM: ['C507'],
      FTX: ['4451', '4453', 'C107', 'C108'],
      GIN: ['7405', 'C208'],
      IMD: ['7077', '7081', 'C273'],
      LIN: ['1082', '1229', 'C212'],
      MOA: ['C516'],
      NAD: ['3035', 'C082', 'C058', 'C080', 'C059', '3164', '3229', '3251', '3207'],
      PAC: ['7224', 'C531', 'C202'],
      PAT: ['4279', 'C110', 'C112'],
      PCI: ['4233'],
      PIA: ['4347', 'C212'],
      PRI: ['C509'],
      QTY: ['C186'],
      RFF: ['C506'],
      TAX: ['5283', 'C241', 'C533', '5286', 'C243', '5305'],
      UCI: ['0020', 'S002', 'S003', '0083', '0085'],
      UCM: ['0062', 'S009', '0083', '0085'],
      UCS: ['0096', '0085'],
      UNH: ['0062', 'S009'],
      UNS: ['0081'],
      UNT: ['0074', '0062'],
      C002: ['1001'],
      C056: ['3413', '3412'],
      C058: ['3124'],
      C059: ['3042'],
      C076: ['3148', '3155'],
      C080: ['3036'],
      C082: ['3039', '1131', '3055'],
      C107: ['4441'],
      C108: ['4440'],
      C110: ['4277'],
      C112: ['2475', '2009', '2151', '2152'],
      C186: ['6063', '6060', '6411'],
      C202: ['7065'],
      C208: ['7402'],
      C212: ['7140', '7143'],
      C241: ['5153'],
      C243: ['5279', '1131', '3055', '5278'],
      C270: ['6069', '6066'],
      C273: ['7009', '1131', '3055', '7008'],
      C504: ['6347', '6345', '6343'],
      C506: ['1153', '1154'],
      C507: ['2005', '2380', '2379'],
      C509: ['5125', '5118'],
      C516: ['5025', '5004'],
      C531: ['7075'],
      C533: ['5289', '1131', '3055'],
      S002: ['0004', '0007'],
      S003: ['0010', '0007'],
      S009: ['0065', '0052', '0054', '0051', '0057'],
    }),
  )

  it.each(messageTypes)(
    'places the parts of every %s segment and composite at their UN D.96A positions',
    (messageType) => {
      for (const parent of partsOf(messageTypeStructures[messageType].children)) {
        const code = parent.kind === 'segment' ? parent.tag : parent.code

        expect({ [parent.path]: parent.children.map((child) => child.code) }).toEqual({
          [parent.path]: layouts.get(code),
        })
      }
    },
  )

  it.each(['SG25/IMD+A/C273/3055', 'SG25/SG33/TAX+7/C243/3055', 'SG50/TAX+7/C533/3055'])(
    'leaves the code list agency of INVOIC %s unfilled',
    (path) => {
      expect(nodeAt(messageTypeStructures.INVOIC.children, path)).toMatchObject({ codes: [] })
    },
  )

  it.each(['SG25/SG33/TAX+7/5305', 'SG50/TAX+7/5305'])(
    'offers the standard, exempt and outside scope tax categories in INVOIC %s',
    (path) => {
      expect(nodeAt(messageTypeStructures.INVOIC.children, path)).toMatchObject({
        codes: [{ code: 'S' }, { code: 'E' }, { code: 'O' }],
      })
    },
  )

  it.each(messageTypes)('gives every node of %s a unique path', (messageType) => {
    const paths = flatten(messageTypeStructures[messageType].children).map(({ path }) => path)

    expect(new Set(paths).size).toBe(paths.length)
  })
})
