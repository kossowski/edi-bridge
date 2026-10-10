import { describe, expect, it } from 'vitest'

import { type MessageTypeStructure, messageTypeStructureSchema } from './message-type'

const documentDate = {
  en: 'Document/message date/time',
  de: 'Dokumenten-/Nachrichtendatum/-zeit',
}

const structure: MessageTypeStructure = {
  messageType: 'ORDERS',
  release: 'D.96A',
  name: { en: 'Purchase order', de: 'Bestellung' },
  children: [
    {
      kind: 'segment',
      path: 'DTM+137',
      tag: 'DTM',
      qualifier: { code: '137', meaning: documentDate },
      name: { en: 'Date/time/period', de: 'Datum/Uhrzeit/Zeitspanne' },
      required: true,
      maxRepeat: 1,
      children: [
        {
          kind: 'composite',
          path: 'DTM+137/C507',
          code: 'C507',
          name: { en: 'Date/time/period', de: 'Datum/Uhrzeit/Zeitspanne' },
          required: true,
          children: [
            {
              kind: 'element',
              path: 'DTM+137/C507/2005',
              code: '2005',
              name: { en: 'Date/time/period qualifier', de: 'Datums-/Zeit-/Zeitspannen-Qualifier' },
              required: true,
              format: 'an..3',
              codes: [{ code: '137', meaning: documentDate }],
            },
          ],
        },
      ],
    },
    {
      kind: 'segmentGroup',
      path: 'SG25',
      code: 'SG25',
      name: { en: 'Line item', de: 'Position' },
      required: true,
      maxRepeat: 9999,
      children: [
        {
          kind: 'segment',
          path: 'SG25/LIN',
          tag: 'LIN',
          qualifier: null,
          name: { en: 'Line item', de: 'Positionsdaten' },
          required: true,
          maxRepeat: 1,
          children: [
            {
              kind: 'element',
              path: 'SG25/LIN/1082',
              code: '1082',
              name: { en: 'Line item number', de: 'Positionsnummer' },
              required: false,
              format: 'an..6',
              codes: [],
            },
          ],
        },
      ],
    },
  ],
}

describe('messageTypeStructureSchema', () => {
  it('accepts segment groups, qualified segments, composites and elements', () => {
    expect(messageTypeStructureSchema.parse(structure)).toEqual(structure)
  })

  it('requires an English and a German meaning', () => {
    const withoutGerman = {
      ...structure,
      children: [{ ...structure.children[0]!, name: { en: 'Date/time/period' } }],
    }

    expect(messageTypeStructureSchema.safeParse(withoutGerman).success).toBe(false)
  })

  it('rejects a repetition below one', () => {
    const neverRepeated = {
      ...structure,
      children: [{ ...structure.children[1]!, maxRepeat: 0 }],
    }

    expect(messageTypeStructureSchema.safeParse(neverRepeated).success).toBe(false)
  })

  it('rejects a composite nested in another composite', () => {
    const [dtm] = structure.children
    const composite = dtm?.kind === 'segment' ? dtm.children[0]! : null

    const nested = {
      ...structure,
      children: [{ ...dtm!, children: [{ ...composite!, children: [composite] }] }],
    }

    expect(messageTypeStructureSchema.safeParse(nested).success).toBe(false)
  })
})
