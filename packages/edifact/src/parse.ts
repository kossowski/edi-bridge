export interface Delimiters {
  component: string
  element: string
  decimal: string
  release: string
  repetition: string
  segment: string
}

export type Element = string[]

export interface Segment {
  tag: string
  elements: Element[]
}

export interface Message {
  header: Segment
  segments: Segment[]
  trailer: Segment
}

export interface Interchange {
  hasServiceStringAdvice: boolean
  delimiters: Delimiters
  header: Segment
  messages: Message[]
  trailer: Segment
}

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
  | 'unterminated-segment'

// Consumers highlight the raw Interchange with it: indexes start at 1, a UNA is segment 1, element 1 follows the tag.
export interface Position {
  segment: number
  element?: number
  component?: number
}

const describePosition = ({ segment, element, component }: Position) =>
  [
    `segment ${segment}`,
    element === undefined ? undefined : `element ${element}`,
    component === undefined ? undefined : `component ${component}`,
  ]
    .filter(Boolean)
    .join(', ')

export class ParseError extends Error {
  override readonly name = 'ParseError'

  constructor(
    readonly code: ParseErrorCode,
    readonly position: Position,
  ) {
    super(`${code} at ${describePosition(position)}`)
  }
}

const defaultDelimiters: Delimiters = {
  component: ':',
  element: '+',
  decimal: '.',
  release: '?',
  repetition: ' ',
  segment: "'",
}

const noReleaseCharacter = ' '

const lineBreak = /[\n\r]/

const segmentTag = /^[A-Z0-9]{3}$/

const serviceStringAdviceTag = 'UNA'

const serviceStringAdviceLength = 9

const segmentPosition = (indexInText: number): Position => ({ segment: indexInText + 1 })

type PositionOf = (index: number) => Position

const tokenize = (text: string, delimiters: Delimiters, positionOf: PositionOf): Segment[] => {
  const segments: Segment[] = []
  let elements: Element[] = []
  let components: string[] = []
  let value = ''
  let released = false

  for (const character of text) {
    if (released) {
      value += character
      released = false
    } else if (character === delimiters.release && character !== noReleaseCharacter) {
      released = true
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
      elements = []
      components = []
      value = ''
    } else {
      const atSegmentStart = elements.length === 0 && components.length === 0 && value === ''

      if (!(atSegmentStart && lineBreak.test(character))) {
        value += character
      }
    }
  }

  if (released || elements.length > 0 || components.length > 0 || value.trim() !== '') {
    const position = positionOf(segments.length)

    if (segments.at(-1)?.tag === 'UNZ') {
      throw new ParseError('text-after-interchange-trailer', position)
    }

    throw new ParseError(
      'unterminated-segment',
      elements.length === 0
        ? position
        : { ...position, element: elements.length, component: components.length + 1 },
    )
  }

  return segments
}

const readDelimiters = (advice: string): Delimiters => {
  const [component = '', element = '', decimal = '', release = '', repetition = '', segment = ''] =
    advice.slice(serviceStringAdviceTag.length)

  const separators = [component, element, segment]

  if (release !== noReleaseCharacter) {
    separators.push(release)
  }

  if (advice.length < serviceStringAdviceLength || new Set(separators).size < separators.length) {
    throw new ParseError('invalid-service-string-advice', segmentPosition(0))
  }

  return { component, element, decimal, release, repetition, segment }
}

const interchangeControlReferenceElement = 5

const messageReferenceElement = 1

const trailerCountElement = 1

const trailerControlReferenceElement = 2

const messageEnvelopeSegments = 2

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

  const segmentsBefore = hasServiceStringAdvice ? 1 : 0
  const position = (index: number) => segmentPosition(segmentsBefore + index)

  const segments = tokenize(
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

      return { hasServiceStringAdvice, delimiters, header, messages, trailer: segment }
    } else {
      throw new ParseError('unexpected-segment', position(index))
    }
  }

  if (openMessage) {
    throw new ParseError('missing-message-trailer', position(openMessage.index))
  }

  throw new ParseError('missing-interchange-trailer', position(0))
}
