import type { Faker } from '@faker-js/faker'

import {
  type ErrorPosition,
  type InterchangeParty,
  type MessageType,
  type ParsedMessage,
  type ParsedSegment,
  type RunError,
  type RunSummary,
  withCheckDigit,
} from '@edi-bridge/contracts'

import { directionOf } from './flow'
import { seededFaker } from './seeded-faker'
import { seedGln } from './trading-partner'
import { seedWorkspace } from './workspace'

type Segment = { tag: string; elements: string[][] }

type FaultyMessage = { segments: Segment[]; fault: Fault | null }

type Fault = {
  segment: number
  element: number | null
  component: number | null
  code: string
  message: string
}

export type GeneratedMessage = {
  reference: string
  segments: Segment[]
  parsed: ParsedMessage | null
  fault: Fault | null
  error: RunError | null
}

const segmentNames = new Map(
  Object.entries({
    UNH: 'Message header',
    BGM: 'Beginning of message',
    DTM: 'Date/time/period',
    RFF: 'Reference',
    NAD: 'Name and address',
    CPS: 'Consignment packing sequence',
    LIN: 'Line item',
    QTY: 'Quantity',
    MOA: 'Monetary amount',
    UNS: 'Section control',
    CNT: 'Control total',
    UCI: 'Interchange response',
    UNT: 'Message trailer',
  }),
)

const messageVersions: Readonly<Record<MessageType, string>> = {
  ORDERS: 'EAN008',
  DESADV: 'EAN007',
  INVOIC: 'EAN008',
  CONTRL: '',
}

export const ownCompany: InterchangeParty = {
  gln: seedWorkspace.gln!,
  name: seedWorkspace.name,
}

export function tradingPartnerParty(
  tradingPartner: RunSummary['tradingPartner'],
): InterchangeParty {
  return {
    gln: seedGln(tradingPartner.id),
    name: tradingPartner.name,
  }
}

function seg(tag: string, ...elements: Array<string | string[]>): Segment {
  return { tag, elements: elements.map((element) => [element].flat()) }
}

function gtin(faker: Faker) {
  return withCheckDigit(`40${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`)
}

function compactDate(iso: string) {
  return iso.slice(0, 10).replaceAll('-', '')
}

function businessSegments(faker: Faker, run: RunSummary, parties: Parties): Segment[] {
  const date = compactDate(run.receivedAt)
  const orderNumber = `PO${faker.string.numeric(6)}`

  const lines = Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => ({
    gtin: gtin(faker),
    quantity: String(faker.number.int({ min: 1, max: 240 })),
    price: faker.number.float({ min: 0.5, max: 80, fractionDigits: 2 }),
  }))

  const outbound = directionOf(run) === 'outbound'
  const buyer = outbound ? parties.receiver : parties.sender
  const supplier = outbound ? parties.sender : parties.receiver

  switch (run.messageType) {
    case 'ORDERS': {
      return [
        seg('BGM', '220', orderNumber, '9'),
        seg('DTM', ['137', date, '102']),
        seg('NAD', 'BY', [buyer.gln, '', '9']),
        seg('NAD', 'SU', [supplier.gln, '', '9']),
        ...lines.flatMap((line, index) => [
          seg('LIN', String(index + 1), '', [line.gtin, 'EN']),
          seg('QTY', ['21', line.quantity, 'PCE']),
        ]),
        seg('UNS', 'S'),
        seg('CNT', ['2', String(lines.length)]),
      ]
    }

    case 'DESADV': {
      return [
        seg('BGM', '351', `DN${faker.string.numeric(6)}`, '9'),
        seg('DTM', ['137', date, '102']),
        seg('RFF', ['ON', orderNumber]),
        seg('NAD', 'BY', [buyer.gln, '', '9']),
        seg('NAD', 'SU', [supplier.gln, '', '9']),
        seg('CPS', '1'),
        ...lines.flatMap((line, index) => [
          seg('LIN', String(index + 1), '', [line.gtin, 'EN']),
          seg('QTY', ['12', line.quantity, 'PCE']),
        ]),
        seg('CNT', ['2', String(lines.length)]),
      ]
    }

    case 'INVOIC': {
      const total = lines.reduce((sum, line) => sum + line.price * Number(line.quantity), 0)

      return [
        seg('BGM', '380', `IN${faker.string.numeric(6)}`, '9'),
        seg('DTM', ['137', date, '102']),
        seg('RFF', ['ON', orderNumber]),
        seg('NAD', 'BY', [buyer.gln, '', '9']),
        seg('NAD', 'SU', [supplier.gln, '', '9']),
        ...lines.flatMap((line, index) => [
          seg('LIN', String(index + 1), '', [line.gtin, 'EN']),
          seg('QTY', ['47', line.quantity, 'PCE']),
          seg('MOA', ['203', (line.price * Number(line.quantity)).toFixed(2)]),
        ]),
        seg('UNS', 'S'),
        seg('MOA', ['86', total.toFixed(2)]),
      ]
    }

    case 'CONTRL': {
      return [
        seg(
          'UCI',
          faker.string.numeric(8),
          [parties.receiver.gln, '14'],
          [parties.sender.gln, '14'],
          '7',
        ),
      ]
    }
  }
}

function indexOf(segments: Segment[], tag: string, qualifier?: string) {
  const index = segments.findIndex(
    (segment) =>
      segment.tag === tag && (qualifier === undefined || segment.elements[0]?.[0] === qualifier),
  )

  return index === -1 ? 1 : index
}

function setComponent(segment: Segment, element: number, component: number, value: string) {
  const elements = segment.elements.map((components) => [...components])
  elements[element - 1]![component - 1] = value

  return { ...segment, elements }
}

function injectFault(faker: Faker, run: RunSummary, segments: Segment[]): FaultyMessage {
  if (run.status !== 'failed') {
    return { segments, fault: null }
  }

  const outbound = directionOf(run) === 'outbound'

  switch (run.failureStage) {
    case 'parse': {
      const qty = segments.findIndex(({ tag }) => tag === 'QTY')

      if (qty !== -1 && faker.datatype.boolean()) {
        const quantity = segments[qty]!.elements[0]![1]!
        const broken = `${quantity}O`

        return {
          segments: segments.with(qty, setComponent(segments[qty]!, 1, 2, broken)),
          fault: {
            segment: qty,
            element: 1,
            component: 2,
            code: 'invalidCharacter',
            message: `Numeric component "${broken}" contains the character "O".`,
          },
        }
      }

      const unt = segments.length - 1
      const declared = String(segments.length + 3)

      return {
        segments: segments.with(unt, setComponent(segments[unt]!, 1, 1, declared)),
        fault: {
          segment: unt,
          element: 1,
          component: null,
          code: 'segmentCountMismatch',
          message: `UNT declares ${declared} segments, but the Message has ${segments.length}.`,
        },
      }
    }

    case 'validation': {
      if (outbound) {
        const nad = indexOf(segments, 'NAD', 'SU')

        return {
          segments: segments.with(nad, setComponent(segments[nad]!, 2, 1, '')),
          fault: {
            segment: nad,
            element: 2,
            component: 1,
            code: 'missingComponent',
            message: 'Required component 3039 (party identification) of NAD+SU is empty.',
          },
        }
      }

      if (run.messageType === 'CONTRL') {
        const uci = indexOf(segments, 'UCI')

        return {
          segments: segments.with(uci, setComponent(segments[uci]!, 4, 1, '9')),
          fault: {
            segment: uci,
            element: 4,
            component: 1,
            code: 'unknownCode',
            message: 'Code "9" is not in code list 0083 (action, coded).',
          },
        }
      }

      const dtm = indexOf(segments, 'DTM', '137')
      const date = `${compactDate(run.receivedAt).slice(0, 4)}1341`

      return {
        segments: segments.with(dtm, setComponent(segments[dtm]!, 1, 2, date)),
        fault: {
          segment: dtm,
          element: 1,
          component: 2,
          code: 'invalidDate',
          message: `"${date}" is not a valid date in format 102 (CCYYMMDD).`,
        },
      }
    }

    case 'mapping': {
      const qty = indexOf(segments, 'QTY')

      return {
        segments: segments.with(qty, setComponent(segments[qty]!, 1, 3, 'KRT')),
        fault: {
          segment: qty,
          element: 1,
          component: 3,
          code: 'lookupMissing',
          message: 'The Lookup Table "Units" has no entry for "KRT".',
        },
      }
    }

    default: {
      return { segments, fault: null }
    }
  }
}

function errorFor(run: RunSummary, faker: Faker, fault: Fault | null): RunError | null {
  if (run.status !== 'failed') {
    return null
  }

  if (fault !== null) {
    return { code: fault.code, message: fault.message, position: null }
  }

  if (run.failureStage === 'mapping') {
    const line = faker.number.int({ min: 1, max: 5 })

    return {
      code: 'missingSourceField',
      message: `The required source field "lines[${line}].gtin" is missing.`,
      position: null,
    }
  }

  return directionOf(run) === 'outbound'
    ? {
        code: 'destinationUnreachable',
        message: `The SFTP server of ${run.tradingPartner.name} refused the connection (ECONNREFUSED).`,
        position: null,
      }
    : {
        code: 'destinationUnavailable',
        message: 'The ERP answered the HTTP POST with 503 Service Unavailable.',
        position: null,
      }
}

type Parties = { sender: InterchangeParty; receiver: InterchangeParty }

export function partiesOf(run: RunSummary): Parties {
  const tradingPartner = tradingPartnerParty(run.tradingPartner)

  return directionOf(run) === 'outbound'
    ? { sender: ownCompany, receiver: tradingPartner }
    : { sender: tradingPartner, receiver: ownCompany }
}

export function generateMessage(run: RunSummary, reference: string): GeneratedMessage {
  const faker = seededFaker(`message:${run.id}`)
  const body = businessSegments(faker, run, partiesOf(run))

  const segments = [
    seg('UNH', reference, [run.messageType, 'D', '96A', 'UN', messageVersions[run.messageType]]),
    ...body,
    seg('UNT', String(body.length + 2), reference),
  ].map((segment) => ({
    ...segment,
    elements: segment.elements.map((components) =>
      components.at(-1) === '' ? components.slice(0, -1) : components,
    ),
  }))

  const faulty = injectFault(faker, run, segments)

  const parsed: ParsedMessage | null =
    run.failureStage === 'parse'
      ? null
      : {
          reference,
          messageType: run.messageType,
          segments: faulty.segments.map((segment): ParsedSegment => ({
            ...segment,
            name: segmentNames.get(segment.tag) ?? null,
          })),
        }

  return {
    reference,
    segments: faulty.segments,
    parsed,
    fault: faulty.fault,
    error: errorFor(run, faker, faulty.fault),
  }
}

const releasable = /[:+?']/g

function serializeSegment({ tag, elements }: Segment) {
  const data = elements.map((components) =>
    components.map((value) => value.replaceAll(releasable, '?$&')).join(':'),
  )

  return `${[tag, ...data].join('+')}'`
}

function interchangeDate(iso: string) {
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}:${iso.slice(11, 13)}${iso.slice(14, 16)}`
}

export type GeneratedInterchange = {
  raw: string
  positions: ReadonlyMap<string, ErrorPosition | null>
}

export function serializeInterchange({
  controlReference,
  parties,
  preparedAt,
  messages,
}: {
  controlReference: string
  parties: Parties
  preparedAt: string
  messages: ReadonlyArray<{ runId: string; message: GeneratedMessage }>
}): GeneratedInterchange {
  const positions = new Map<string, ErrorPosition | null>()

  const lines = [
    serializeSegment(
      seg(
        'UNB',
        ['UNOC', '3'],
        [parties.sender.gln, '14'],
        [parties.receiver.gln, '14'],
        interchangeDate(preparedAt).split(':'),
        controlReference,
      ),
    ),
  ]

  for (const { runId, message } of messages) {
    const { fault, segments } = message
    positions.set(
      runId,
      fault && {
        segment: lines.length + 1 + fault.segment,
        tag: segments[fault.segment]!.tag,
        element: fault.element,
        component: fault.component,
      },
    )
    lines.push(...segments.map(serializeSegment))
  }

  lines.push(serializeSegment(seg('UNZ', String(messages.length), controlReference)))

  return { raw: `UNA:+.? '${lines.join('')}`, positions }
}
