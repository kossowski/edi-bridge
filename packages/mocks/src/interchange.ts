import type { Faker } from '@faker-js/faker'

import {
  directionOf,
  type ErrorPosition,
  type FailureStage,
  type FixTarget,
  type InterchangeParty,
  type MessageType,
  type ParsedMessage,
  type ParsedSegment,
  type ProblemReason,
  type RunError,
  type RunSummary,
  withCheckDigit,
} from '@edi-bridge/contracts'

import type { ValidationErrorCode } from '@edi-bridge/edifact'

import { seedFlows } from './flow'
import { seedLookupTableNamed } from './lookup-table-seed'
import { publishedVersionsByMapping, seedMappingDrafts } from './mapping'
import { seededFaker } from './seeded-faker'
import { seedGln } from './trading-partner'
import { seedWorkspace } from './workspace'

type Segment = { tag: string; elements: string[][] }

export type GeneratedErrorCode =
  | 'invalidCharacter'
  | 'segmentCountMismatch'
  | Extract<
      ValidationErrorCode,
      'missing-element' | 'too-long-element' | 'unknown-code' | 'wrong-format'
    >
  | 'lookupMissing'
  | 'missingSourceField'
  | 'destinationUnreachable'
  | 'destinationUnavailable'
  | 'glnMissing'
  | 'channelDefect'
  | 'characterSetUnsupported'
  | 'processingDefect'

export type GeneratedError = RunError & { code: GeneratedErrorCode }

// `defect` pins whether the Run stops on a Defect, for a story or test that needs one either way.
type ProblemFields = Pick<RunSummary, 'id' | 'messageType' | 'flow' | 'failureStage'> & {
  defect?: boolean | undefined
}

export type BrokenPiece =
  | Pick<Extract<FixTarget, { kind: 'mapping' }>, 'kind' | 'fieldPath'>
  | Pick<Extract<FixTarget, { kind: 'lookupTable' }>, 'kind' | 'name' | 'code'>
  | { kind: SetupPiece }

export type SetupPiece = Extract<
  FixTarget['kind'],
  'workspaceGln' | 'tradingPartnerGln' | 'channelCredential' | 'tradingPartner'
>

const setupPieces = [
  'workspaceGln',
  'tradingPartnerGln',
  'channelCredential',
  'tradingPartner',
] as const

const setupErrors: Record<SetupPiece, GeneratedError> = {
  workspaceGln: {
    code: 'glnMissing',
    message: 'The Workspace has no GLN for the Interchange',
    position: null,
    details: null,
  },
  tradingPartnerGln: {
    code: 'glnMissing',
    message: 'The Trading Partner has no GLN for the Interchange',
    position: null,
    details: null,
  },
  channelCredential: {
    code: 'channelDefect',
    message: 'The Channel could not be used for the delivery',
    position: null,
    details: null,
  },
  tradingPartner: {
    code: 'characterSetUnsupported',
    message: 'Delivery in character set UNOD is not supported',
    position: null,
    details: null,
  },
}

// A separate seed keeps the Messages of the other Runs as they were.
function incompleteSetupOf(run: ProblemFields): Failure | null {
  if (run.failureStage !== 'delivery' || directionOf(run) !== 'outbound') {
    return null
  }

  const kind = seededFaker(`setupPiece:${run.id}`).helpers.weightedArrayElement([
    { weight: 9, value: null },
    ...setupPieces.map((piece) => ({ weight: 1, value: piece })),
  ])

  return kind && { error: setupErrors[kind], broken: { kind } }
}

// The api checks the GLNs and the character set before it builds the Interchange.
export function failsBeforeInterchange(run: ProblemFields) {
  const code = incompleteSetupOf(run)?.error?.code

  return code === 'glnMissing' || code === 'characterSetUnsupported'
}

const defectError: GeneratedError = {
  code: 'processingDefect',
  message: 'The processing stopped on an unexpected error',
  position: null,
  details: null,
}

// A separate seed keeps the Messages of the other Runs as they were.
function stopsOnDefect(run: ProblemFields) {
  return (
    run.failureStage === 'mapping' &&
    (run.defect ?? seededFaker(`defect:${run.id}`).datatype.boolean({ probability: 0.1 }))
  )
}

// The summary has drawn the Defect already, so the Message follows it instead of drawing again.
function isDefect(run: RunSummary) {
  return run.problem?.reason === 'defect'
}

type Fault = {
  segment: number
  element: number | null
  component: number | null
  code: GeneratedErrorCode
  message: string
}

type FaultyMessage = { segments: Segment[]; fault: Fault | null; broken: BrokenPiece | null }

type Failure = { error: GeneratedError | null; broken: BrokenPiece | null }

export type GeneratedMessage = Failure & {
  reference: string
  segments: Segment[]
  parsed: ParsedMessage | null
  fault: Fault | null
}

const missingUnit = { kind: 'lookupTable', name: 'Units of measure', code: 'KRT' } as const

const missingUnitError = {
  code: 'lookupMissing',
  message: `The Lookup Table "${missingUnit.name}" has no entry for "${missingUnit.code}".`,
  position: null,
  details: null,
} as const

let unitReadingFlowIds: ReadonlySet<string> | undefined

// Only outbound Mappings translate your units for the partner, so only their Runs miss one.
function readsUnits(run: Pick<RunSummary, 'flow'>) {
  unitReadingFlowIds ??= unitReadingFlows()

  return unitReadingFlowIds.has(run.flow.id)
}

function unitReadingFlows() {
  const units = seedLookupTableNamed(missingUnit.name).id
  const versions = publishedVersionsByMapping(seedMappingDrafts)

  const mappingIds = new Set(
    seedMappingDrafts
      .filter(({ transforms }) =>
        transforms.some(
          (transform) =>
            transform.kind === 'lookupTable' && transform.config.lookupTableId === units,
        ),
      )
      .map(({ id }) => id),
  )

  return new Set(
    seedFlows
      .filter(({ mappingVersionId }) =>
        mappingIds.has(versions.find(mappingVersionId)?.version.mappingId ?? ''),
      )
      .map(({ id }) => id),
  )
}

export function lookupTableFailureOf(run: RunSummary): Failure | null {
  return run.status === 'failed' &&
    run.failureStage === 'mapping' &&
    directionOf(run) === 'outbound' &&
    readsUnits(run) &&
    !isDefect(run)
    ? { error: missingUnitError, broken: missingUnit }
    : null
}

// Follows the Failure the Message of a failed Run is generated with, without generating it.
export function problemReasonOf(
  run: ProblemFields & { failureStage: FailureStage },
): ProblemReason {
  switch (run.failureStage) {
    case 'parse': {
      return 'unreadable'
    }

    case 'validation': {
      return 'invalidContent'
    }

    case 'mapping': {
      if (stopsOnDefect(run)) {
        return 'defect'
      }

      return directionOf(run) === 'outbound' && readsUnits(run) ? 'missingCode' : 'missingField'
    }

    case 'delivery': {
      return incompleteSetupOf(run) === null ? 'unreachable' : 'incompleteSetup'
    }
  }
}

const partyGlnFields = { BY: 'buyer.gln', SU: 'supplier.gln' } as const

const lineLists: Readonly<Record<MessageType, string>> = {
  ORDERS: 'lines',
  DESADV: 'packages[].lines',
  INVOIC: 'lines',
  CONTRL: 'lines',
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

// Every seeded UNB is readable, so each party has its identification.
type SeedParty = InterchangeParty & { identification: string }

export const ownCompany: SeedParty = {
  identification: seedWorkspace.gln!,
  name: seedWorkspace.name,
}

export function tradingPartnerParty(tradingPartner: RunSummary['tradingPartner']): SeedParty {
  return {
    identification: seedGln(tradingPartner.id),
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
  // Drawn even when replaced, so the rest of the Message keeps its seeded values.
  const generatedOrderNumber = `PO${faker.string.numeric(6)}`
  const orderNumber = run.businessReference ?? generatedOrderNumber

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
        seg('NAD', 'BY', [buyer.identification, '', '9']),
        seg('NAD', 'SU', [supplier.identification, '', '9']),
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
        seg('NAD', 'BY', [buyer.identification, '', '9']),
        seg('NAD', 'SU', [supplier.identification, '', '9']),
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
        seg('NAD', 'BY', [buyer.identification, '', '9']),
        seg('NAD', 'SU', [supplier.identification, '', '9']),
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
          [parties.receiver.identification, '14'],
          [parties.sender.identification, '14'],
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
  const intact = { segments, fault: null, broken: null }

  if (run.status !== 'failed' || isDefect(run)) {
    return intact
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
          broken: null,
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
        broken: null,
      }
    }

    case 'validation': {
      if (outbound) {
        const party = faker.helpers.objectKey(partyGlnFields)
        const nad = indexOf(segments, 'NAD', party)
        const gln = segments[nad]!.elements[1]![0]!
        // A separate seed keeps the Messages of the other Runs as they were.
        const tooLong = seededFaker(`validationFault:${run.id}`).datatype.boolean()
        // The mapping joins the GLNs of all addresses instead of taking the first one.
        const value = tooLong ? [gln, gln, gln].join(',') : ''

        return {
          segments: segments.with(nad, setComponent(segments[nad]!, 2, 1, value)),
          fault: {
            segment: nad,
            element: 2,
            component: 1,
            ...(tooLong
              ? {
                  code: 'too-long-element',
                  message: `Component 3039 (party identification) of NAD+${party} has ${String(value.length)} characters, but its format an..35 allows 35.`,
                }
              : {
                  code: 'missing-element',
                  message: `Required component 3039 (party identification) of NAD+${party} is empty.`,
                }),
          },
          broken: { kind: 'mapping', fieldPath: partyGlnFields[party] },
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
            code: 'unknown-code',
            message: 'Code "9" is not in code list 0083 (action, coded).',
          },
          broken: null,
        }
      }

      const qty = indexOf(segments, 'QTY')
      // The partner writes the unit into the quantity as well.
      const quantity = `${segments[qty]!.elements[0]![1]!} PCE`

      return {
        segments: segments.with(qty, setComponent(segments[qty]!, 1, 2, quantity)),
        fault: {
          segment: qty,
          element: 1,
          component: 2,
          code: 'wrong-format',
          message: `Component 6060 (quantity) of QTY is "${quantity}", but its format n..15 allows only digits.`,
        },
        broken: null,
      }
    }

    case 'mapping': {
      if (!outbound) {
        const lin = indexOf(segments, 'LIN')

        return {
          segments: segments.with(lin, setComponent(segments[lin]!, 3, 1, '')),
          fault: {
            segment: lin,
            element: 3,
            component: 1,
            code: 'missingSourceField',
            message: 'The required source field "lines[1].gtin" is missing.',
          },
          broken: { kind: 'mapping', fieldPath: 'lines[].gtin' },
        }
      }

      if (!readsUnits(run)) {
        return intact
      }

      const qty = indexOf(segments, 'QTY')

      return {
        segments: segments.with(qty, setComponent(segments[qty]!, 1, 3, missingUnit.code)),
        fault: {
          segment: qty,
          element: 1,
          component: 3,
          code: missingUnitError.code,
          message: missingUnitError.message,
        },
        broken: missingUnit,
      }
    }

    default: {
      return intact
    }
  }
}

function failureOf(run: RunSummary, faker: Faker, { fault, broken }: FaultyMessage): Failure {
  if (run.status !== 'failed') {
    return { error: null, broken: null }
  }

  if (fault !== null) {
    return {
      error: { code: fault.code, message: fault.message, position: null, details: null },
      broken,
    }
  }

  if (isDefect(run)) {
    return { error: defectError, broken: null }
  }

  if (run.failureStage === 'mapping') {
    const line = faker.number.int({ min: 1, max: 5 })
    const lines = lineLists[run.messageType]

    return {
      error: {
        code: 'missingSourceField',
        message: `The required source field "${lines}[${line}].gtin" is missing.`,
        position: null,
        details: null,
      },
      broken: { kind: 'mapping', fieldPath: `${lines}[].gtin` },
    }
  }

  const incompleteSetup = incompleteSetupOf(run)

  if (incompleteSetup !== null) {
    return incompleteSetup
  }

  return {
    error:
      directionOf(run) === 'outbound'
        ? {
            code: 'destinationUnreachable',
            message: `The SFTP server of ${run.tradingPartner.name} refused the connection (ECONNREFUSED).`,
            position: null,
            details: null,
          }
        : {
            code: 'destinationUnavailable',
            message: 'The ERP answered the HTTP POST with 503 Service Unavailable.',
            position: null,
            details: { kind: 'httpResponse', status: 503 },
          },
    broken: null,
  }
}

type Parties = { sender: SeedParty; receiver: SeedParty }

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
    ...failureOf(run, faker, faulty),
  }
}

const releasable = /[:+?']/g

export function serializeSegment({ tag, elements }: Segment) {
  const data = elements.map((components) =>
    components.map((value) => value.replaceAll(releasable, '?$&')).join(':'),
  )

  return `${[tag, ...data].join('+')}'`
}

function interchangeDate(iso: string) {
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}:${iso.slice(11, 13)}${iso.slice(14, 16)}`
}

// Validation of an outbound Message sees it alone, so the api counts its UNH as segment 1.
export function messagePositionOf({ fault, segments }: GeneratedMessage): ErrorPosition | null {
  return (
    fault && {
      segment: fault.segment + 1,
      // SAFETY: injectFault places each fault on an index of the segments it returns.
      tag: segments[fault.segment]!.tag,
      element: fault.element,
      component: fault.component,
    }
  )
}

const serviceStringAdvice = "UNA:+.? '"

export type GeneratedInterchange = {
  raw: string
  positions: ReadonlyMap<string, ErrorPosition | null>
}

export function serializeInterchange({
  controlReference,
  parties,
  preparedAt,
  messages,
  testIndicator = false,
}: {
  controlReference: string
  parties: Parties
  preparedAt: string
  messages: ReadonlyArray<{ runId: string; message: GeneratedMessage }>
  testIndicator?: boolean
}): GeneratedInterchange {
  const positions = new Map<string, ErrorPosition | null>()

  const lines = [
    serviceStringAdvice,
    serializeSegment(
      seg(
        'UNB',
        ['UNOC', '3'],
        [parties.sender.identification, '14'],
        [parties.receiver.identification, '14'],
        interchangeDate(preparedAt).split(':'),
        controlReference,
        // UNB 0035 follows five optional elements.
        ...(testIndicator ? ['', '', '', '', '', '1'] : []),
      ),
    ),
  ]

  for (const { runId, message } of messages) {
    const position = messagePositionOf(message)
    // The Interchange so far comes before the Message, so it shifts the Message's own position.
    positions.set(runId, position && { ...position, segment: lines.length + position.segment })
    lines.push(...message.segments.map(serializeSegment))
  }

  lines.push(serializeSegment(seg('UNZ', String(messages.length), controlReference)))

  return { raw: lines.join(''), positions }
}
