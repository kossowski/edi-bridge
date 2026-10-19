import { messageIdentifierElement } from './message-identifier'
import { isBrokenMessage } from './model'
import { ParseError, readInterchange } from './parse'
import { interchangeSegmentPosition } from './position'
import { validate, ValidationError } from './validate'

import type { Element, Envelope, Interchange, Message, ParsedMessage, Segment } from './model'
import type { ParseErrorCode } from './parse'
import type { Position } from './position'
import type { ValidationErrorCode } from './validate'

export type BuildContrlErrorCode = 'unreadable-interchange-header'

export class BuildContrlError extends Error {
  override readonly name = 'BuildContrlError'

  constructor(
    readonly code: BuildContrlErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
  }
}

const contrlIdentifier = ['CONTRL', 'D', '3', 'UN', 'EAN002']

const accepted = '7'

const rejected = '4'

const senderElement = 2

const recipientElement = 3

const controlReferenceElement = 5

const messageReferenceElement = 1

const partyComponents = 3

const messageIdentifierComponents = 5

// Codes of the syntax version 3 code list 0085.
const parseErrorCodes: Record<ParseErrorCode, string> = {
  'control-reference-mismatch': '28',
  'invalid-segment-tag': '12',
  'invalid-service-string-advice': '22',
  'message-count-mismatch': '29',
  'missing-interchange-header': '13',
  'missing-interchange-trailer': '13',
  'missing-message-trailer': '13',
  'segment-count-mismatch': '29',
  'text-after-interchange-trailer': '33',
  // Parse finds unexpected segments only outside a Message.
  'unexpected-segment': '33',
  'unneeded-release-character': '22',
  'unterminated-segment': '13',
}

const validationErrorCodes: Record<ValidationErrorCode, string> = {
  'invalid-character': '21',
  'missing-element': '13',
  'missing-segment': '13',
  'too-long-element': '39',
  'too-many-repetitions': '35',
  'unexpected-element': '16',
  'unexpected-segment': '15',
  'unknown-code': '12',
  'unsupported-message-type': '14',
  'wrong-format': '37',
}

type SyntaxError = ParseError | ValidationError

const syntaxErrorCode = (error: SyntaxError) =>
  error instanceof ParseError ? parseErrorCodes[error.code] : validationErrorCodes[error.code]

const valueOf = (segment: Segment, element: number) => segment.elements[element - 1]?.[0] ?? ''

const partyOf = (header: Segment, element: number): Element =>
  (header.elements[element - 1] ?? []).slice(0, partyComponents)

const withoutTrailingEmptyElements = ({ tag, elements }: Segment): Segment => {
  const last = elements.findLastIndex((values) => values.some(Boolean))

  return { tag, elements: elements.slice(0, last + 1) }
}

// S011 names the component only within a composite the sender filled beyond its first component.
const dataElementIdentification = (
  segment: Segment | undefined,
  { element, component }: Position,
): Element => {
  if (element === undefined) {
    return []
  }

  const values = segment?.elements[element - 1] ?? []

  return component !== undefined && (values.length > 1 || component > 1)
    ? [String(element), String(component)]
    : [String(element)]
}

const validationErrorOf = (interchange: Interchange) => {
  try {
    validate(interchange)

    return undefined
  } catch (error) {
    if (error instanceof ValidationError) {
      return error
    }

    throw error
  }
}

const serviceSegmentTags = new Set(['UNB', 'UNH', 'UNT', 'UNZ'])

const missingTrailerTags: Partial<Record<ParseErrorCode, string>> = {
  'missing-interchange-trailer': 'UNZ',
  'missing-message-trailer': 'UNT',
}

// Undefined for an error in a user data segment. segmentAt takes the segment number of the error position.
const serviceSegmentError = (
  error: SyntaxError,
  segmentAt: (segment: number) => Segment | undefined,
): Element[] | undefined => {
  const code = syntaxErrorCode(error)
  const missingTrailer = error instanceof ParseError ? missingTrailerTags[error.code] : undefined

  if (missingTrailer) {
    return [[code], [missingTrailer]]
  }

  const segment = segmentAt(error.position.segment)

  return error.code !== 'missing-segment' && segment && serviceSegmentTags.has(segment.tag)
    ? [[code], [segment.tag], dataElementIdentification(segment, error.position)]
    : undefined
}

// The position in segmentAt counts from the Message's UNH as segment 1.
const messageResponse = (
  { header }: ParsedMessage,
  error: SyntaxError | undefined,
  firstSegment: number,
  segmentAt: (position: number) => Segment | undefined,
): Segment[] => {
  const reference = [valueOf(header, messageReferenceElement)]

  const identifier = (header.elements[messageIdentifierElement - 1] ?? []).slice(
    0,
    messageIdentifierComponents,
  )

  if (error === undefined) {
    return [{ tag: 'UCM', elements: [reference, identifier, [accepted]] }]
  }

  const position = error.position.segment - firstSegment + 1
  const segment = segmentAt(position)

  const serviceError = serviceSegmentError(error, (number) => segmentAt(number - firstSegment + 1))

  if (serviceError) {
    return [
      withoutTrailingEmptyElements({
        tag: 'UCM',
        elements: [reference, identifier, [rejected], ...serviceError],
      }),
    ]
  }

  const code = syntaxErrorCode(error)
  const identification = dataElementIdentification(segment, error.position)

  return [
    { tag: 'UCM', elements: [reference, identifier, [rejected]] },
    identification.length === 0
      ? { tag: 'UCS', elements: [[String(position)], [code]] }
      : { tag: 'UCS', elements: [[String(position)]] },
    ...(identification.length === 0 ? [] : [{ tag: 'UCD', elements: [[code], identification] }]),
  ]
}

const messageResponses = (
  envelope: Envelope,
  messages: ParsedMessage[],
  messageIndexes: number[],
  received: Segment[],
) => {
  const positionOf = interchangeSegmentPosition(envelope.hasServiceStringAdvice)
  // validate counts the segments of a Message checked alone from the first UNH.
  const firstSegmentAlone = positionOf(1).segment

  return messages.flatMap((message, index) => {
    if (isBrokenMessage(message)) {
      const headerIndex = messageIndexes[index] ?? 0

      return messageResponse(
        message,
        message.error,
        positionOf(headerIndex).segment,
        (position) => received[headerIndex + position - 1],
      )
    }

    const messageSegments = [message.header, ...message.segments, message.trailer]

    return messageResponse(
      message,
      validationErrorOf({ ...envelope, messages: [message] }),
      firstSegmentAlone,
      (position) => messageSegments[position - 1],
    )
  })
}

const readableInterchange = (text: string) => {
  try {
    const reading = readInterchange(text)
    const { header } = reading

    if (
      header === undefined ||
      [controlReferenceElement, senderElement, recipientElement].some(
        (element) => valueOf(header, element) === '',
      )
    ) {
      throw new BuildContrlError('unreadable-interchange-header')
    }

    return { ...reading, header }
  } catch (error) {
    if (error instanceof ParseError) {
      throw new BuildContrlError('unreadable-interchange-header', { cause: error })
    }

    throw error
  }
}

export const buildContrl = (text: string, messageReference: string): Message => {
  const {
    hasServiceStringAdvice,
    header,
    messages,
    messageIndexes,
    segments: received,
    envelope,
  } = readableInterchange(text)

  const positionOf = interchangeSegmentPosition(hasServiceStringAdvice)

  const envelopeError =
    envelope instanceof ParseError ? envelope : validationErrorOf({ ...envelope, messages: [] })

  // A parse error counts segments in the received text, validation of the envelope alone counts UNB and UNZ only.
  const envelopeSegmentAt = (segment: number) =>
    envelope instanceof ParseError
      ? received[segment - positionOf(0).segment]
      : [envelope.header, envelope.trailer][segment - positionOf(0).segment]

  const interchangeResponse = withoutTrailingEmptyElements({
    tag: 'UCI',
    elements: [
      [valueOf(header, controlReferenceElement)],
      partyOf(header, senderElement),
      partyOf(header, recipientElement),
      ...(envelopeError === undefined
        ? [[accepted]]
        : [
            [rejected],
            ...(serviceSegmentError(envelopeError, envelopeSegmentAt) ?? [
              [syntaxErrorCode(envelopeError)],
            ]),
          ]),
    ],
  })

  const segments =
    envelopeError === undefined && !(envelope instanceof ParseError)
      ? [interchangeResponse, ...messageResponses(envelope, messages, messageIndexes, received)]
      : [interchangeResponse]

  return {
    header: { tag: 'UNH', elements: [[messageReference], contrlIdentifier] },
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  }
}
