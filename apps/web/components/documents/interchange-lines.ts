import type { ErrorPosition } from '@edi-bridge/contracts'

export type InterchangeLine = {
  number: number | null
  text: string
  highlight: readonly [start: number, end: number] | null
}

export type HighlightPrecision = 'segment' | 'element' | 'component'

type LocatedPosition = { highlight: readonly [number, number]; precision: HighlightPrecision }

export type InterchangeLines = { lines: InterchangeLine[]; precision: HighlightPrecision | null }

type Separators = { component: string; element: string; release: string; terminator: string }

const defaultSeparators: Separators = {
  component: ':',
  element: '+',
  release: '?',
  terminator: "'",
}

function adviceOf(raw: string) {
  return raw.startsWith('UNA') && raw.length >= 9 ? raw.slice(0, 9) : null
}

function separatorsOf(advice: string | null): Separators {
  if (advice === null) {
    return defaultSeparators
  }

  // ISO 9735 reserves a space in the release position for "no release character".
  const release = advice[6] === ' ' ? '' : advice[6]!

  return { component: advice[3]!, element: advice[4]!, release, terminator: advice[8]! }
}

function splitSegments(raw: string, separators: Separators) {
  const segments: string[] = []
  let start = 0

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]

    if (char === separators.release) {
      index++
    } else if (char === separators.terminator) {
      segments.push(raw.slice(start, index + 1).replace(/^[\r\n]+/, ''))
      start = index + 1
    }
  }

  const rest = raw.slice(start).trim()

  return rest === '' ? segments : [...segments, rest]
}

function splitRanges(text: string, start: number, end: number, separator: string, release: string) {
  const ranges: Array<[number, number]> = []
  let from = start

  for (let index = start; index < end; index++) {
    if (text[index] === release) {
      index++
    } else if (text[index] === separator) {
      ranges.push([from, index])
      from = index + 1
    }
  }

  ranges.push([from, end])

  return ranges
}

function locate(
  text: string,
  position: ErrorPosition,
  separators: Separators,
): LocatedPosition | null {
  const body = text.endsWith(separators.terminator) ? text.length - 1 : text.length
  const [tag] = splitRanges(text, 0, body, separators.element, separators.release)

  if (text.slice(...tag!) !== position.tag) {
    return null
  }

  const segment = { highlight: [0, body] as const, precision: 'segment' as const }

  if (position.element === null) {
    return segment
  }

  const element = splitRanges(text, 0, body, separators.element, separators.release)[
    position.element
  ]

  if (element === undefined) {
    return segment
  }

  if (position.component === null) {
    return { highlight: element, precision: 'element' }
  }

  const component = splitRanges(
    text,
    element[0],
    element[1],
    separators.component,
    separators.release,
  )[position.component - 1]

  return component
    ? { highlight: component, precision: 'component' }
    : { highlight: element, precision: 'element' }
}

export function interchangeLines(source: string, position: ErrorPosition | null): InterchangeLines {
  const raw = source.replace(/^[\uFEFF\s]+/, '')
  const advice = adviceOf(raw)
  const separators = separatorsOf(advice)
  const segments = splitSegments(advice === null ? raw : raw.slice(9), separators)
  let precision: HighlightPrecision | null = null

  const lines = segments.map((text, index): InterchangeLine => {
    const number = index + 1

    if (position?.segment !== number) {
      return { number, text, highlight: null }
    }

    const located = locate(text, position, separators)

    if (located === null) {
      return { number, text, highlight: null }
    }

    precision = located.precision

    return { number, text, highlight: located.highlight }
  })

  return {
    lines: advice === null ? lines : [{ number: null, text: advice, highlight: null }, ...lines],
    precision,
  }
}
