import { defaultDelimiters, hasReleaseCharacter, serviceCharacters } from './delimiters'
import { isBrokenMessage } from './model'
import {
  describePosition,
  interchangeSegmentPosition,
  messageEnvelopeSegments,
  type Position,
} from './position'

import type {
  Delimiters,
  Element,
  Envelope,
  Interchange,
  ParsedInterchange,
  ParsedMessage,
  Segment,
} from './model'

export type ParseErrorCode =
  | 'control-reference-mismatch'
  | 'invalid-segment-tag'
  | 'invalid-service-string-advice'
  | 'message-count-mismatch'
  | 'missing-interchange-header'
  | 'missing-interchange-trailer'
  | 'missing-message-trailer'
  | 'segment-count-mismatch'
  | 'text-after-interchange-trailer'
  | 'unexpected-segment'
  | 'unneeded-release-character'
  | 'unterminated-segment'

export class ParseError extends Error {
  override readonly name = 'ParseError'

  constructor(
    readonly code: ParseErrorCode,
    readonly position: Position,
  ) {
    super(`${code} at ${describePosition(position)}`)
  }
}

const segmentTagLength = 3

const segmentTag = /^[A-Z0-9]{3}$/

const serviceStringAdviceTag = 'UNA'

const serviceStringAdviceLength = 9

const serviceStringAdvicePosition: Position = { segment: 1 }

type PositionOf = (index: number) => Position

interface Tokens {
  segments: Segment[]
  segmentErrors: (ParseError | undefined)[]
  endError: ParseError | undefined
  lineBreaks: string[]
  trailingText: string
}

const isLineBreak = (character: string) => character === '\r' || character === '\n'

const tokenize = (text: string, delimiters: Delimiters, positionOf: PositionOf): Tokens => {
  const segments: Segment[] = []
  const segmentErrors: (ParseError | undefined)[] = []
  let segmentError: ParseError | undefined
  const lineBreaks: string[] = []
  let lineBreak = ''
  let offset = 0
  let trailingFrom = 0
  let elements: Element[] = []
  let components: string[] = []
  let value = ''
  let releasing = false

  const released = new Set(serviceCharacters(delimiters))
  const releaseCharacter = hasReleaseCharacter(delimiters) ? delimiters.release : undefined

  const currentPosition = () => {
    const position = positionOf(segments.length)

    return elements.length === 0
      ? position
      : { ...position, element: elements.length, component: components.length + 1 }
  }

  for (const character of text) {
    offset += character.length

    if (releasing) {
      if (!released.has(character)) {
        segmentError ??= new ParseError('unneeded-release-character', currentPosition())
      }

      value += character
      releasing = false
    } else if (character === releaseCharacter) {
      releasing = true
    } else if (character === delimiters.component) {
      components.push(value)
      value = ''
    } else if (character === delimiters.element) {
      elements.push([...components, value])
      components = []
      value = ''
    } else if (character === delimiters.segment) {
      const [tagElement = [], ...rest] = [...elements, [...components, value]]
      const [tag = ''] = tagElement

      const validTag = tagElement.length === 1 && segmentTag.test(tag)

      if (!validTag) {
        segmentError ??= new ParseError('invalid-segment-tag', positionOf(segments.length))
      }

      segments.push({
        tag: validTag ? tag : tagElement.join(delimiters.component),
        elements: rest,
      })
      segmentErrors.push(segmentError)
      segmentError = undefined
      lineBreaks.push(lineBreak)
      lineBreak = ''
      trailingFrom = offset
      elements = []
      components = []
      value = ''
    } else if (
      isLineBreak(character) &&
      elements.length === 0 &&
      components.length === 0 &&
      value === ''
    ) {
      lineBreak += character
    } else {
      value += character
    }
  }

  const unterminated =
    releasing || elements.length > 0 || components.length > 0 || value.trim() !== ''

  const endError = !unterminated
    ? undefined
    : segments.at(-1)?.tag === 'UNZ'
      ? new ParseError('text-after-interchange-trailer', positionOf(segments.length))
      : new ParseError('unterminated-segment', currentPosition())

  return {
    segments,
    segmentErrors,
    endError,
    lineBreaks,
    trailingText: text.slice(trailingFrom),
  }
}

const readDelimiters = (advice: string): Delimiters => {
  const [component = '', element = '', decimal = '', release = '', repetition = '', segment = ''] =
    advice.slice(serviceStringAdviceTag.length)

  const delimiters = { component, element, decimal, release, repetition, segment }
  const separators = serviceCharacters(delimiters)

  if (advice.length < serviceStringAdviceLength || new Set(separators).size < separators.length) {
    throw new ParseError('invalid-service-string-advice', serviceStringAdvicePosition)
  }

  return delimiters
}

const interchangeControlReferenceElement = 5

const messageReferenceElement = 1

const trailerCountElement = 1

const trailerControlReferenceElement = 2

const controlValue = (segment: Segment, element: number) => segment.elements[element - 1]?.[0]

const matchesCount = (value: string | undefined, count: number) =>
  value !== undefined && /^\d+$/.test(value) && Number(value) === count

interface TrailerCheck {
  trailer: Segment
  position: Position
  countMismatch: ParseErrorCode
  count: number
  controlReference: string | undefined
}

const trailerError = ({
  trailer,
  position,
  countMismatch,
  count,
  controlReference,
}: TrailerCheck) => {
  if (!matchesCount(controlValue(trailer, trailerCountElement), count)) {
    return new ParseError(countMismatch, {
      ...position,
      element: trailerCountElement,
      component: 1,
    })
  }

  if (controlValue(trailer, trailerControlReferenceElement) !== controlReference) {
    return new ParseError('control-reference-mismatch', {
      ...position,
      element: trailerControlReferenceElement,
      component: 1,
    })
  }

  return undefined
}

interface ReadMessage {
  headerIndex: number
  message: ParsedMessage
}

interface Reading {
  hasServiceStringAdvice: boolean
  segments: Segment[]
  header: Segment | undefined
  tokenErrors: ParseError[]
  messages: ReadMessage[]
  envelope: Envelope | ParseError
}

interface OpenMessage {
  index: number
  header: Segment
  segments: Segment[]
  error: ParseError | undefined
}

export const readInterchange = (text: string): Reading => {
  const hasServiceStringAdvice = text.startsWith(serviceStringAdviceTag)

  const delimiters = hasServiceStringAdvice
    ? readDelimiters(text.slice(0, serviceStringAdviceLength))
    : defaultDelimiters

  const position = interchangeSegmentPosition(hasServiceStringAdvice)

  const { segments, segmentErrors, endError, lineBreaks, trailingText } = tokenize(
    hasServiceStringAdvice ? text.slice(serviceStringAdviceLength) : text,
    delimiters,
    position,
  )

  const tokenErrors = [...segmentErrors, endError].filter((error) => error !== undefined)
  const messages: ReadMessage[] = []
  const [firstSegment] = segments
  const header = !segmentErrors[0] && firstSegment?.tag === 'UNB' ? firstSegment : undefined

  const reading = {
    hasServiceStringAdvice,
    segments,
    header,
    tokenErrors,
    messages,
  }

  const failed = (error: ParseError): Reading => ({ ...reading, envelope: error })

  if (segmentErrors[0]) {
    return failed(segmentErrors[0])
  }

  if (header === undefined) {
    return failed(new ParseError('missing-interchange-header', position(0)))
  }

  let openMessage: OpenMessage | undefined

  const closeWithoutTrailer = (message: OpenMessage) => {
    messages.push({
      headerIndex: message.index,
      message: {
        header: message.header,
        error: message.error ?? new ParseError('missing-message-trailer', position(message.index)),
      },
    })
    openMessage = undefined
  }

  for (const [index, segment] of segments.entries()) {
    const segmentError = segmentErrors[index]

    if (index === 0) {
      continue
    }

    if (openMessage && segment.tag === 'UNT') {
      const error =
        openMessage.error ??
        segmentError ??
        trailerError({
          trailer: segment,
          position: position(index),
          countMismatch: 'segment-count-mismatch',
          count: openMessage.segments.length + messageEnvelopeSegments,
          controlReference: controlValue(openMessage.header, messageReferenceElement),
        })

      messages.push({
        headerIndex: openMessage.index,
        message: error
          ? { header: openMessage.header, error }
          : { header: openMessage.header, segments: openMessage.segments, trailer: segment },
      })
      openMessage = undefined
    } else if (openMessage && segment.tag !== 'UNH' && segment.tag !== 'UNZ') {
      openMessage.segments.push(segment)
      openMessage.error ??= segmentError
    } else {
      if (openMessage) {
        closeWithoutTrailer(openMessage)
      }

      if (segment.tag === 'UNH') {
        openMessage = { index, header: segment, segments: [], error: segmentError }
      } else if (segmentError) {
        return failed(segmentError)
      } else if (segment.tag !== 'UNZ') {
        return failed(new ParseError('unexpected-segment', position(index)))
      } else if (index < segments.length - 1) {
        return failed(new ParseError('unexpected-segment', position(index + 1)))
      } else {
        const error =
          endError ??
          trailerError({
            trailer: segment,
            position: position(index),
            countMismatch: 'message-count-mismatch',
            count: messages.length,
            controlReference: controlValue(header, interchangeControlReferenceElement),
          })

        return error
          ? failed(error)
          : {
              ...reading,
              envelope: {
                hasServiceStringAdvice,
                delimiters,
                header,
                trailer: segment,
                whitespace: { lineBreaks, trailingText },
              },
            }
      }
    }
  }

  if (openMessage) {
    closeWithoutTrailer(openMessage)
  }

  return failed(endError ?? new ParseError('missing-interchange-trailer', position(0)))
}

const readDelimitersOrUndefined = (advice: string) => {
  try {
    return readDelimiters(advice)
  } catch (error) {
    if (error instanceof ParseError) {
      return undefined
    }

    throw error
  }
}

// Where the character after a text cut short within an Interchange stands, and in which segment.
export const positionAfter = (text: string) => {
  const hasServiceStringAdvice = text.startsWith(serviceStringAdviceTag)

  const delimiters = hasServiceStringAdvice
    ? readDelimitersOrUndefined(text.slice(0, serviceStringAdviceLength))
    : defaultDelimiters

  if (delimiters === undefined) {
    return { position: serviceStringAdvicePosition, tag: serviceStringAdviceTag }
  }

  const position = interchangeSegmentPosition(hasServiceStringAdvice)

  const { segments, endError, trailingText } = tokenize(
    hasServiceStringAdvice ? text.slice(serviceStringAdviceLength) : text,
    delimiters,
    position,
  )

  return {
    position: endError?.position ?? position(segments.length),
    tag: trailingText.trim().slice(0, segmentTagLength),
  }
}

export const parseMessages = (text: string): ParsedInterchange => {
  const { messages, envelope } = readInterchange(text)

  if (envelope instanceof ParseError) {
    throw envelope
  }

  return { ...envelope, messages: messages.map(({ message }) => message) }
}

export const parse = (text: string): Interchange => {
  const { tokenErrors, messages, envelope } = readInterchange(text)

  if (tokenErrors[0]) {
    throw tokenErrors[0]
  }

  const validMessages = messages.map(({ message }) => {
    if (isBrokenMessage(message)) {
      throw message.error
    }

    return message
  })

  if (envelope instanceof ParseError) {
    throw envelope
  }

  return { ...envelope, messages: validMessages }
}
