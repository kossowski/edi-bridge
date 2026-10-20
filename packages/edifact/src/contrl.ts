import { type CharacterSetError } from './character-set'
import { defaultDelimiters } from './delimiters'
import { messageIdentifierElement } from './message-identifier'
import { isBrokenMessage } from './model'
import { ParseError, readInterchange } from './parse'
import { interchangeSegmentPosition } from './position'
import { validate, ValidationError } from './validate'

import type { Element, Envelope, Interchange, Message, ParsedMessage, Segment } from './model'
import type { ParseErrorCode } from './parse'
import type { Position } from './position'
import type { ValidationErrorCode } from './validate'

export type BuildContrlErrorCode = 'unechoable-interchange-header' | 'unreadable-interchange-header'

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

const parseErrorCodes: Record<ParseErrorCode, string> = {
  'control-reference-mismatch': '28',
  'invalid-segment-tag': '12',
  'invalid-service-string-advice': '20',
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

type ReceivedError = ParseError | ValidationError

const invalidCharacterCode = validationErrorCodes['invalid-character']

const syntaxErrorCode = (error: ReceivedError) =>
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

const serviceSegmentError = (
  error: ReceivedError,
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

const contrlOf = (messageReference: string, segments: Segment[]): Message => ({
  header: { tag: 'UNH', elements: [[messageReference], contrlIdentifier] },
  segments,
  trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
})

// The CONTRL goes out in UNOC, whatever syntax the received Interchange used.
const contrlErrorOf = (segments: Segment[]) =>
  validationErrorOf({
    hasServiceStringAdvice: false,
    delimiters: defaultDelimiters,
    header: { tag: 'UNB', elements: [['UNOC', '3']] },
    messages: [contrlOf('C', segments)],
    trailer: { tag: 'UNZ', elements: [] },
  })

const messageResponseOf = (header: Segment, ...response: Element[]): Segment => ({
  tag: 'UCM',
  elements: [
    [valueOf(header, messageReferenceElement)],
    (header.elements[messageIdentifierElement - 1] ?? []).slice(0, messageIdentifierComponents),
    ...response,
  ],
})

const messageResponse = (
  header: Segment,
  error: ReceivedError | undefined,
  firstSegment: number,
  segmentAt: (position: number) => Segment | undefined,
): Segment[] => {
  if (error === undefined) {
    return [messageResponseOf(header, [accepted])]
  }

  const position = error.position.segment - firstSegment + 1
  const serviceError = serviceSegmentError(error, (number) => segmentAt(number - firstSegment + 1))

  if (serviceError) {
    return [withoutTrailingEmptyElements(messageResponseOf(header, [rejected], ...serviceError))]
  }

  const code = syntaxErrorCode(error)
  const identification = dataElementIdentification(segmentAt(position), error.position)

  return [
    messageResponseOf(header, [rejected]),
    identification.length === 0
      ? { tag: 'UCS', elements: [[String(position)], [code]] }
      : { tag: 'UCS', elements: [[String(position)]] },
    ...(identification.length === 0 ? [] : [{ tag: 'UCD', elements: [[code], identification] }]),
  ]
}

// UCM elements 1 and 2 echo UNH elements 1 and 2, so the UCM's error position names the UNH's.
const unechoableHeaderError = (acceptance: Segment, messages: ParsedMessage[]) => {
  for (const { header } of messages) {
    const error = contrlErrorOf([acceptance, messageResponseOf(header, [accepted])])

    if (error) {
      return [
        [rejected],
        [validationErrorCodes[error.code]],
        ['UNH'],
        dataElementIdentification(header, error.position),
      ]
    }
  }

  return undefined
}

const messageResponses = (
  envelope: Envelope,
  messages: { headerIndex: number; message: ParsedMessage }[],
  received: Segment[],
) => {
  const positionOf = interchangeSegmentPosition(envelope.hasServiceStringAdvice)
  // validate counts the segments of a Message checked alone from the first UNH.
  const firstSegmentAlone = positionOf(1).segment

  return messages.flatMap(({ headerIndex, message }) => {
    if (isBrokenMessage(message)) {
      return messageResponse(
        message.header,
        message.error,
        positionOf(headerIndex).segment,
        (position) => received[headerIndex + position - 1],
      )
    }

    const messageSegments = [message.header, ...message.segments, message.trailer]

    return messageResponse(
      message.header,
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

const rejection = (
  error: ReceivedError,
  segmentAt: (segment: number) => Segment | undefined,
): Element[] => [
  [rejected],
  ...(serviceSegmentError(error, segmentAt) ?? [[syntaxErrorCode(error)]]),
]

// A UCI names only a service segment, so a byte in another segment rejects without a position.
const invalidCharacterRejection = (
  { position, tag }: CharacterSetError,
  segmentAt: (segment: number) => Segment | undefined,
): Element[] => {
  const segment = segmentAt(position.segment)

  return serviceSegmentTags.has(tag)
    ? [[rejected], [invalidCharacterCode], [tag], dataElementIdentification(segment, position)]
    : [[rejected], [invalidCharacterCode]]
}

export const buildContrl = (
  text: string,
  messageReference: string,
  { invalidCharacter }: { invalidCharacter?: CharacterSetError | undefined } = {},
): Message => {
  const {
    hasServiceStringAdvice,
    header,
    messages,
    segments: received,
    envelope,
  } = readableInterchange(text)

  const firstSegment = interchangeSegmentPosition(hasServiceStringAdvice)(0).segment
  const receivedAt = (segment: number) => received[segment - firstSegment]

  const interchangeResponse = (...response: Element[]) =>
    withoutTrailingEmptyElements({
      tag: 'UCI',
      elements: [
        [valueOf(header, controlReferenceElement)],
        partyOf(header, senderElement),
        partyOf(header, recipientElement),
        ...response,
      ],
    })

  const acceptance = interchangeResponse([accepted])

  if (contrlErrorOf([acceptance])) {
    throw new BuildContrlError('unechoable-interchange-header')
  }

  const responses = () => {
    // The text holds U+FFFD in place of the invalid bytes, so nothing read from it is accepted.
    if (invalidCharacter) {
      return [interchangeResponse(...invalidCharacterRejection(invalidCharacter, receivedAt))]
    }

    if (envelope instanceof ParseError) {
      return [interchangeResponse(...rejection(envelope, receivedAt))]
    }

    const envelopeError = validationErrorOf({ ...envelope, messages: [] })

    if (envelopeError) {
      // Validation of the envelope alone counts only UNB and UNZ.
      const envelopeSegments = [envelope.header, envelope.trailer]

      return [
        interchangeResponse(
          ...rejection(envelopeError, (segment) => envelopeSegments[segment - firstSegment]),
        ),
      ]
    }

    const headerError = unechoableHeaderError(
      acceptance,
      messages.map(({ message }) => message),
    )

    return headerError
      ? [interchangeResponse(...headerError)]
      : [acceptance, ...messageResponses(envelope, messages, received)]
  }

  const segments = responses()
  const contrlError = contrlErrorOf(segments)

  if (contrlError) {
    throw new Error('Built an invalid CONTRL', { cause: contrlError })
  }

  return contrlOf(messageReference, segments)
}
