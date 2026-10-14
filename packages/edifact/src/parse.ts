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
  | 'unexpected-segment'
  | 'unterminated-segment'

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

const tokenize = (text: string, delimiters: Delimiters, firstSegment: number): Segment[] => {
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
        throw new ParseError('invalid-segment-tag', { segment: firstSegment + segments.length })
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
    const segment = firstSegment + segments.length
    const inTag = elements.length === 0

    throw new ParseError(
      'unterminated-segment',
      inTag ? { segment } : { segment, element: elements.length, component: components.length + 1 },
    )
  }

  return segments
}

const serviceStringAdviceLength = 9

const readDelimiters = (advice: string): Delimiters => {
  const delimiters = {
    component: advice.charAt(3),
    element: advice.charAt(4),
    decimal: advice.charAt(5),
    release: advice.charAt(6),
    repetition: advice.charAt(7),
    segment: advice.charAt(8),
  }

  const separators = [delimiters.component, delimiters.element, delimiters.segment]

  if (delimiters.release !== noReleaseCharacter) {
    separators.push(delimiters.release)
  }

  if (advice.length < serviceStringAdviceLength || new Set(separators).size < separators.length) {
    throw new ParseError('invalid-service-string-advice', { segment: 1 })
  }

  return delimiters
}

const controlValue = (segment: Segment, element: number) => segment.elements[element - 1]?.[0]

const matchesCount = (value: string | undefined, count: number) =>
  value !== undefined && /^\d+$/.test(value) && Number(value) === count

export const parse = (text: string): Interchange => {
  const hasServiceStringAdvice = text.startsWith('UNA')

  const delimiters = hasServiceStringAdvice
    ? readDelimiters(text.slice(0, serviceStringAdviceLength))
    : defaultDelimiters

  const firstSegment = hasServiceStringAdvice ? 2 : 1

  const segments = tokenize(
    hasServiceStringAdvice ? text.slice(serviceStringAdviceLength) : text,
    delimiters,
    firstSegment,
  )

  const header = segments[0]
  const position = (index: number) => ({ segment: firstSegment + index })

  const controlPosition = (index: number, element: number) => ({
    ...position(index),
    element,
    component: 1,
  })

  if (header?.tag !== 'UNB') {
    throw new ParseError('missing-interchange-header', position(0))
  }

  const messages: Message[] = []
  let openMessage: Omit<Message, 'trailer'> | undefined

  for (const [index, segment] of segments.entries()) {
    if (index === 0) {
      continue
    }

    if (openMessage) {
      if (segment.tag === 'UNT') {
        if (!matchesCount(controlValue(segment, 1), openMessage.segments.length + 2)) {
          throw new ParseError('segment-count-mismatch', controlPosition(index, 1))
        }

        if (controlValue(segment, 2) !== controlValue(openMessage.header, 1)) {
          throw new ParseError('control-reference-mismatch', controlPosition(index, 2))
        }

        messages.push({ ...openMessage, trailer: segment })
        openMessage = undefined
      } else if (segment.tag === 'UNH' || segment.tag === 'UNZ') {
        throw new ParseError('missing-message-trailer', position(index))
      } else {
        openMessage.segments.push(segment)
      }
    } else if (segment.tag === 'UNH') {
      openMessage = { header: segment, segments: [] }
    } else if (segment.tag === 'UNZ') {
      if (index < segments.length - 1) {
        throw new ParseError('unexpected-segment', position(index + 1))
      }

      if (!matchesCount(controlValue(segment, 1), messages.length)) {
        throw new ParseError('message-count-mismatch', controlPosition(index, 1))
      }

      if (controlValue(segment, 2) !== controlValue(header, 5)) {
        throw new ParseError('control-reference-mismatch', controlPosition(index, 2))
      }

      return { hasServiceStringAdvice, delimiters, header, messages, trailer: segment }
    } else {
      throw new ParseError('unexpected-segment', position(index))
    }
  }

  throw new ParseError(
    openMessage ? 'missing-message-trailer' : 'missing-interchange-trailer',
    position(segments.length),
  )
}
