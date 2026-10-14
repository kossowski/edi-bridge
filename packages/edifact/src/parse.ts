import { defaultDelimiters, hasReleaseCharacter, serviceCharacters } from './delimiters'
import {
  describePosition,
  interchangeSegmentPosition,
  messageEnvelopeSegments,
  type Position,
} from './position'

import type { Delimiters, Element, Interchange, Message, Segment } from './model'

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

const segmentTag = /^[A-Z0-9]{3}$/

const serviceStringAdviceTag = 'UNA'

const serviceStringAdviceLength = 9

const serviceStringAdvicePosition: Position = { segment: 1 }

type PositionOf = (index: number) => Position

interface Tokens {
  segments: Segment[]
  lineBreaks: string[]
  trailingText: string
}

const isLineBreak = (character: string) => character === '\r' || character === '\n'

const tokenize = (text: string, delimiters: Delimiters, positionOf: PositionOf): Tokens => {
  const segments: Segment[] = []
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
        throw new ParseError('unneeded-release-character', currentPosition())
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

      if (tagElement.length !== 1 || !segmentTag.test(tag)) {
        throw new ParseError('invalid-segment-tag', positionOf(segments.length))
      }

      segments.push({ tag, elements: rest })
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

  if (releasing || elements.length > 0 || components.length > 0 || value.trim() !== '') {
    if (segments.at(-1)?.tag === 'UNZ') {
      throw new ParseError('text-after-interchange-trailer', positionOf(segments.length))
    }

    throw new ParseError('unterminated-segment', currentPosition())
  }

  return { segments, lineBreaks, trailingText: text.slice(trailingFrom) }
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

const checkTrailer = ({
  trailer,
  position,
  countMismatch,
  count,
  controlReference,
}: TrailerCheck) => {
  if (!matchesCount(controlValue(trailer, trailerCountElement), count)) {
    throw new ParseError(countMismatch, { ...position, element: trailerCountElement, component: 1 })
  }

  if (controlValue(trailer, trailerControlReferenceElement) !== controlReference) {
    throw new ParseError('control-reference-mismatch', {
      ...position,
      element: trailerControlReferenceElement,
      component: 1,
    })
  }
}

export const parse = (text: string): Interchange => {
  const hasServiceStringAdvice = text.startsWith(serviceStringAdviceTag)

  const delimiters = hasServiceStringAdvice
    ? readDelimiters(text.slice(0, serviceStringAdviceLength))
    : defaultDelimiters

  const position = interchangeSegmentPosition(hasServiceStringAdvice)

  const { segments, lineBreaks, trailingText } = tokenize(
    hasServiceStringAdvice ? text.slice(serviceStringAdviceLength) : text,
    delimiters,
    position,
  )

  const header = segments[0]

  if (header?.tag !== 'UNB') {
    throw new ParseError('missing-interchange-header', position(0))
  }

  const messages: Message[] = []
  let openMessage: { index: number; header: Segment; segments: Segment[] } | undefined

  for (const [index, segment] of segments.entries()) {
    if (index === 0) {
      continue
    }

    if (openMessage) {
      if (segment.tag === 'UNT') {
        checkTrailer({
          trailer: segment,
          position: position(index),
          countMismatch: 'segment-count-mismatch',
          count: openMessage.segments.length + messageEnvelopeSegments,
          controlReference: controlValue(openMessage.header, messageReferenceElement),
        })

        messages.push({
          header: openMessage.header,
          segments: openMessage.segments,
          trailer: segment,
        })
        openMessage = undefined
      } else if (segment.tag === 'UNH' || segment.tag === 'UNZ') {
        throw new ParseError('missing-message-trailer', position(openMessage.index))
      } else {
        openMessage.segments.push(segment)
      }
    } else if (segment.tag === 'UNH') {
      openMessage = { index, header: segment, segments: [] }
    } else if (segment.tag === 'UNZ') {
      if (index < segments.length - 1) {
        throw new ParseError('unexpected-segment', position(index + 1))
      }

      checkTrailer({
        trailer: segment,
        position: position(index),
        countMismatch: 'message-count-mismatch',
        count: messages.length,
        controlReference: controlValue(header, interchangeControlReferenceElement),
      })

      return {
        hasServiceStringAdvice,
        delimiters,
        header,
        messages,
        trailer: segment,
        whitespace: { lineBreaks, trailingText },
      }
    } else {
      throw new ParseError('unexpected-segment', position(index))
    }
  }

  if (openMessage) {
    throw new ParseError('missing-message-trailer', position(openMessage.index))
  }

  throw new ParseError('missing-interchange-trailer', position(0))
}
