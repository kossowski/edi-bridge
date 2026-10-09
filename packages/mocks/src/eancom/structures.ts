import {
  type EdifactCode,
  type EdifactComposite,
  type EdifactElement,
  type EdifactStructureNode,
  type LocalizedText,
  type MessageType,
  type MessageTypeStructure,
  messageTypeStructureSchema,
} from '@edi-bridge/contracts'

import { compositeDefinition, elementDefinition, segmentDefinition } from './dictionary'

type Occurrence = { required?: boolean; maxRepeat?: number }

type SegmentUse = Occurrence & {
  kind: 'segment'
  tag: string
  qualifier: string | undefined
  // Narrows an element's code list to the codes this use allows, e.g. 1001 to 220 in ORDERS.
  codes?: Readonly<Record<string, ReadonlyArray<string>>>
}

type GroupUse = Occurrence & {
  kind: 'group'
  code: string
  qualifier: string | undefined
  name: LocalizedText
  children: ReadonlyArray<Use>
}

type Use = SegmentUse | GroupUse

type StructureDefinition = Omit<MessageTypeStructure, 'children'> & { uses: ReadonlyArray<Use> }

function segment(
  tagAndQualifier: string,
  occurrence: Omit<SegmentUse, 'kind' | 'tag' | 'qualifier'> = {},
): SegmentUse {
  const [tag = '', qualifier] = tagAndQualifier.split('+')

  return { kind: 'segment', tag, qualifier, ...occurrence }
}

function group(
  codeAndQualifier: string,
  name: LocalizedText,
  occurrence: Occurrence,
  children: ReadonlyArray<Use>,
): GroupUse {
  const [code = '', qualifier] = codeAndQualifier.split('+')

  return { kind: 'group', code, qualifier, name, ...occurrence, children }
}

function codesOf(elementCode: string, only?: ReadonlyArray<string>): EdifactCode[] {
  const all = elementDefinition(elementCode)?.codes ?? {}
  const wanted = only ?? Object.keys(all)

  return wanted.map((code) => {
    const meaning = all[code]

    if (!meaning) {
      throw new Error(`Element ${elementCode} has no code ${code}`)
    }

    return { code, meaning }
  })
}

function element(
  code: string,
  required: boolean,
  parentPath: string,
  narrowed: Readonly<Record<string, ReadonlyArray<string>>>,
): EdifactElement {
  const definition = elementDefinition(code)

  if (!definition) {
    throw new Error(`Unknown element ${code}`)
  }

  return {
    kind: 'element',
    path: `${parentPath}/${code}`,
    code,
    name: definition.name,
    required,
    format: definition.format,
    codes: codesOf(code, narrowed[code]),
  }
}

function segmentChild(
  code: string,
  required: boolean,
  parentPath: string,
  narrowed: Readonly<Record<string, ReadonlyArray<string>>>,
): EdifactComposite | EdifactElement {
  const composite = compositeDefinition(code)

  if (!composite) {
    return element(code, required, parentPath, narrowed)
  }

  const path = `${parentPath}/${code}`

  return {
    kind: 'composite',
    path,
    code,
    name: composite.name,
    required,
    children: composite.elements.map(([child, childRequired]) =>
      element(child, childRequired, path, narrowed),
    ),
  }
}

function build(uses: ReadonlyArray<Use>, parentPath: string): EdifactStructureNode[] {
  return uses.map((use) => {
    const prefix = parentPath === '' ? '' : `${parentPath}/`
    const occurrence = { required: use.required ?? false, maxRepeat: use.maxRepeat ?? 1 }

    if (use.kind === 'group') {
      const path = `${prefix}${use.code}${use.qualifier ? `+${use.qualifier}` : ''}`

      return {
        kind: 'segmentGroup',
        path,
        code: use.code,
        name: use.name,
        ...occurrence,
        children: build(use.children, path),
      }
    }

    const definition = segmentDefinition(use.tag)

    if (!definition) {
      throw new Error(`Unknown segment ${use.tag}`)
    }

    const qualifiedBy = definition.qualifiedBy

    const qualifier =
      use.qualifier && qualifiedBy ? codesOf(qualifiedBy, [use.qualifier])[0]! : null

    if (use.qualifier && !qualifier) {
      throw new Error(`Segment ${use.tag} takes no qualifier`)
    }

    const narrowed =
      qualifier && qualifiedBy
        ? { ...use.codes, [qualifiedBy]: [qualifier.code] }
        : (use.codes ?? {})

    const path = `${prefix}${use.tag}${qualifier ? `+${qualifier.code}` : ''}`

    return {
      kind: 'segment',
      path,
      tag: use.tag,
      qualifier,
      name: definition.name,
      ...occurrence,
      children: definition.children.map(([code, required]) =>
        segmentChild(code, required, path, narrowed),
      ),
    }
  })
}

const text = (en: string, de: string): LocalizedText => ({ en, de })

const m = { required: true } as const

function header(messageType: MessageType, release = '96A', version = 'D') {
  return segment('UNH', {
    ...m,
    codes: { '0065': [messageType], '0052': [version], '0054': [release] },
  })
}

const trailer = segment('UNT', m)

const parties = text('Name and address', 'Name und Anschrift')

function party(qualifier: string, occurrence: Occurrence, children: ReadonlyArray<Use> = []) {
  return group(`SG2+${qualifier}`, parties, occurrence, [
    segment(`NAD+${qualifier}`, m),
    ...children,
  ])
}

const vatNumber = group(
  'SG3',
  text('Party reference', 'Referenz des Beteiligten'),
  { maxRepeat: 10 },
  [segment('RFF+VA', m)],
)

function reference(qualifier: string, occurrence: Occurrence = { maxRepeat: 10 }) {
  return group(`SG1+${qualifier}`, text('Reference', 'Referenz'), occurrence, [
    segment(`RFF+${qualifier}`, m),
    segment('DTM+171'),
  ])
}

const productIdentification = [
  segment('PIA+1', { maxRepeat: 25, codes: { '7143': ['SA', 'IN'] } }),
  segment('IMD+F', { maxRepeat: 99 }),
]

const lineItem = segment('LIN', { ...m, codes: { '7143': ['EN'] } })

const lineCount = segment('CNT+2', { maxRepeat: 10 })

const orders: StructureDefinition = {
  messageType: 'ORDERS',
  release: 'D.96A',
  name: text('Purchase order', 'Bestellung'),
  uses: [
    header('ORDERS'),
    segment('BGM', { ...m, codes: { '1001': ['220'] } }),
    segment('DTM+137', m),
    segment('DTM+2'),
    segment('FTX+AAI', { maxRepeat: 99 }),
    reference('CT'),
    party('BY', m, [
      vatNumber,
      group('SG5', text('Contact details', 'Kontaktangaben'), { maxRepeat: 5 }, [
        segment('CTA+OC', m),
        segment('COM', { maxRepeat: 5 }),
      ]),
    ]),
    party('SU', m, [vatNumber]),
    party('DP', {}),
    party('IV', {}),
    group('SG7', text('Currencies', 'Währungen'), { maxRepeat: 5 }, [
      segment('CUX', { ...m, codes: { '6343': ['9'] } }),
    ]),
    group('SG25', text('Line item', 'Position'), { ...m, maxRepeat: 9999 }, [
      lineItem,
      ...productIdentification,
      segment('QTY+21', m),
      segment('DTM+2'),
      group('SG28', text('Price details', 'Preisangaben'), { maxRepeat: 25 }, [
        segment('PRI+AAA', m),
      ]),
    ]),
    segment('UNS', m),
    lineCount,
    trailer,
  ],
}

const desadv: StructureDefinition = {
  messageType: 'DESADV',
  release: 'D.96A',
  name: text('Despatch advice', 'Liefermeldung'),
  uses: [
    header('DESADV'),
    segment('BGM', { ...m, codes: { '1001': ['351'] } }),
    segment('DTM+137', m),
    segment('DTM+11'),
    segment('DTM+17'),
    reference('ON'),
    party('BY', m),
    party('SU', m),
    party('DP', m),
    group(
      'SG10',
      text('Consignment packing sequence', 'Packstückfolge'),
      { ...m, maxRepeat: 9999 },
      [
        segment('CPS', m),
        group('SG11', text('Package', 'Packstück'), { maxRepeat: 9999 }, [
          segment('PAC', m),
          group(
            'SG13',
            text('Package identification', 'Packstückkennzeichnung'),
            { maxRepeat: 1000 },
            [
              segment('PCI+33E', m),
              group(
                'SG15',
                text('Goods identity number', 'Warenidentifikationsnummer'),
                { maxRepeat: 10 },
                [segment('GIN+BJ', m)],
              ),
            ],
          ),
        ]),
        group('SG17', text('Line item', 'Position'), { maxRepeat: 9999 }, [
          lineItem,
          ...productIdentification,
          segment('QTY+12', m),
        ]),
      ],
    ),
    lineCount,
    trailer,
  ],
}

const invoic: StructureDefinition = {
  messageType: 'INVOIC',
  release: 'D.96A',
  name: text('Invoice', 'Rechnung'),
  uses: [
    header('INVOIC'),
    segment('BGM', { ...m, codes: { '1001': ['380', '381'] } }),
    segment('DTM+137', m),
    segment('DTM+35'),
    reference('ON'),
    reference('DQ'),
    party('BY', m, [vatNumber]),
    party('SU', m, [vatNumber]),
    party('IV', {}),
    party('DP', {}),
    group('SG7', text('Currencies', 'Währungen'), { ...m, maxRepeat: 5 }, [
      segment('CUX', { ...m, codes: { '6343': ['4'] } }),
    ]),
    group('SG8', text('Payment terms', 'Zahlungsbedingungen'), { maxRepeat: 10 }, [
      segment('PAT+1', m),
      segment('DTM+13'),
    ]),
    group('SG25', text('Line item', 'Position'), { maxRepeat: 9999 }, [
      lineItem,
      ...productIdentification,
      segment('QTY+47', m),
      group('SG26', text('Line amount', 'Positionsbetrag'), { maxRepeat: 5 }, [
        segment('MOA+203', m),
      ]),
      group('SG28', text('Price details', 'Preisangaben'), { maxRepeat: 25 }, [
        segment('PRI+AAA', m),
      ]),
      group('SG33', text('Line tax', 'Positionssteuer'), { maxRepeat: 5 }, [segment('TAX+7', m)]),
    ]),
    segment('UNS', m),
    lineCount,
    group('SG48', text('Totals', 'Summen'), { ...m, maxRepeat: 100 }, [
      segment('MOA+77', m),
      segment('MOA+79'),
      segment('MOA+125'),
      segment('MOA+176'),
    ]),
    group('SG50', text('Tax totals', 'Steuersummen'), { maxRepeat: 10 }, [
      segment('TAX+7', m),
      segment('MOA+124'),
    ]),
    trailer,
  ],
}

const contrl: StructureDefinition = {
  messageType: 'CONTRL',
  release: 'D.3',
  name: text('Syntax and service report', 'Syntax- und Servicebericht'),
  uses: [
    header('CONTRL', '3'),
    segment('UCI', { ...m, codes: { '0007': ['14'] } }),
    group('SG1', text('Message response', 'Antwort auf Nachricht'), { maxRepeat: 999_999 }, [
      segment('UCM', m),
      group('SG2', text('Segment error', 'Segmentfehler'), { maxRepeat: 999 }, [segment('UCS', m)]),
    ]),
    trailer,
  ],
}

function structureOf({ uses, ...structure }: StructureDefinition): MessageTypeStructure {
  return messageTypeStructureSchema.parse({ ...structure, children: build(uses, '') })
}

export const messageTypeStructures: Readonly<Record<MessageType, MessageTypeStructure>> = {
  ORDERS: structureOf(orders),
  DESADV: structureOf(desadv),
  INVOIC: structureOf(invoic),
  CONTRL: structureOf(contrl),
}
