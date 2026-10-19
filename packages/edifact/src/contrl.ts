import { messageIdentifierElement } from './message-identifier'
import { isBrokenMessage } from './model'
import { readInterchange } from './parse'
import { interchangeSegmentPosition } from './position'
import { validate, ValidationError } from './validate'

import type { BrokenMessage, Element, Envelope, Message, Segment } from './model'
import type { ParseError, ParseErrorCode } from './parse'
import type { Position } from './position'
import type { ValidationErrorCode } from './validate'

const contrlIdentifier = ['CONTRL', 'D', '3', 'UN', 'EAN002']

const accepted = '7'

const rejected = '4'

const controlReferenceElement = 5

const messageReferenceElement = 1

const partyComponents = 3

const messageIdentifierComponents = 5

// Syntax version 3 code list 0085.
const syntaxErrorCodes: Record<ParseErrorCode | ValidationErrorCode, string> = {
  'control-reference-mismatch': '28',
  'invalid-character': '21',
  'invalid-segment-tag': '12',
  'invalid-service-string-advice': '22',
  'message-count-mismatch': '29',
  'missing-element': '13',
  'missing-interchange-header': '13',
  'missing-interchange-trailer': '13',
  'missing-message-trailer': '13',
  'missing-segment': '13',
  'segment-count-mismatch': '29',
  'text-after-interchange-trailer': '33',
  'too-long-element': '39',
  'too-many-repetitions': '35',
  'unexpected-element': '16',
  'unexpected-segment': '15',
  'unknown-code': '12',
  'unneeded-release-character': '22',
  'unsupported-message-type': '14',
  'unterminated-segment': '13',
  'wrong-format': '37',
}

const partyOf = (header: Segment, element: number): Element =>
  (header.elements[element - 1] ?? []).slice(0, partyComponents)

// S011 names the component only within a composite the sender filled beyond its first component.
const dataElementIdentification = (
  segment: Segment | undefined,
  { element, component }: Position,
) => {
  if (element === undefined) {
    return []
  }

  const values = segment?.elements[element - 1] ?? []

  return component !== undefined && (values.length > 1 || component > 1)
    ? [String(element), String(component)]
    : [String(element)]
}

const messageError = (envelope: Envelope, message: Message) => {
  try {
    validate({ ...envelope, messages: [message] })

    return undefined
  } catch (error) {
    if (error instanceof ValidationError) {
      return error
    }

    throw error
  }
}

const serviceSegmentTags = new Set(['UNH', 'UNT'])

// segmentAt takes the position in the Message, counted from its UNH as segment 1.
const messageResponse = (
  { header }: Message | BrokenMessage,
  error: ParseError | ValidationError | undefined,
  firstSegment: number,
  segmentAt: (position: number) => Segment | undefined,
): Segment[] => {
  const reference = [header.elements[messageReferenceElement - 1]?.[0] ?? '']

  const identifier = (header.elements[messageIdentifierElement - 1] ?? []).slice(
    0,
    messageIdentifierComponents,
  )

  if (error === undefined) {
    return [{ tag: 'UCM', elements: [reference, identifier, [accepted]] }]
  }

  const position = error.position.segment - firstSegment + 1
  const segment = segmentAt(position)
  const code = syntaxErrorCodes[error.code]
  const identification = dataElementIdentification(segment, error.position)

  if (error.code === 'missing-message-trailer') {
    return [{ tag: 'UCM', elements: [reference, identifier, [rejected], [code], ['UNT']] }]
  }

  if (error.code !== 'missing-segment' && segment && serviceSegmentTags.has(segment.tag)) {
    return [
      {
        tag: 'UCM',
        elements: [reference, identifier, [rejected], [code], [segment.tag], identification],
      },
    ]
  }

  return [
    { tag: 'UCM', elements: [reference, identifier, [rejected]] },
    identification.length === 0
      ? { tag: 'UCS', elements: [[String(position)], [code]] }
      : { tag: 'UCS', elements: [[String(position)]] },
    ...(identification.length === 0 ? [] : [{ tag: 'UCD', elements: [[code], identification] }]),
  ]
}

export const buildContrl = (text: string, messageReference: string): Message => {
  const { header, messages, messageIndexes, segments: received, envelope } = readInterchange(text)

  if (header === undefined || envelope instanceof Error) {
    throw new Error('unreadable')
  }

  const positionOf = interchangeSegmentPosition(envelope.hasServiceStringAdvice)
  // validate counts the segments of a Message checked alone from the first UNH.
  const firstSegmentAlone = positionOf(1).segment

  const segments: Segment[] = [
    {
      tag: 'UCI',
      elements: [
        [header.elements[controlReferenceElement - 1]?.[0] ?? ''],
        partyOf(header, 2),
        partyOf(header, 3),
        [accepted],
      ],
    },
    ...messages.flatMap((message, index) => {
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
        messageError(envelope, message),
        firstSegmentAlone,
        (position) => messageSegments[position - 1],
      )
    }),
  ]

  return {
    header: { tag: 'UNH', elements: [[messageReference], contrlIdentifier] },
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  }
}
