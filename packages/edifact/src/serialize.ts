import { defaultDelimiters, hasReleaseCharacter, serviceCharacters } from './delimiters'
import { describePosition, type Position } from './position'

import type { Delimiters, Interchange, Segment, Whitespace } from './model'

export type SerializeErrorCode = 'unreleasable-service-character'

export class SerializeError extends Error {
  override readonly name = 'SerializeError'

  constructor(
    readonly code: SerializeErrorCode,
    readonly position: Position,
  ) {
    super(`${code} at ${describePosition(position)}`)
  }
}

const serializeValue = (value: string, delimiters: Delimiters, position: Position) => {
  const service = new Set(serviceCharacters(delimiters))
  const characters = [...value]

  if (hasReleaseCharacter(delimiters)) {
    return characters
      .map((character) => (service.has(character) ? delimiters.release + character : character))
      .join('')
  }

  if (characters.some((character) => service.has(character))) {
    throw new SerializeError('unreleasable-service-character', position)
  }

  return value
}

const serializeSegment = ({ tag, elements }: Segment, delimiters: Delimiters, segment: number) =>
  [
    tag,
    ...elements.map((components, elementIndex) =>
      components
        .map((value, componentIndex) =>
          serializeValue(value, delimiters, {
            segment,
            element: elementIndex + 1,
            component: componentIndex + 1,
          }),
        )
        .join(delimiters.component),
    ),
  ].join(delimiters.element) + delimiters.segment

const serviceStringAdvice = ({
  component,
  element,
  decimal,
  release,
  repetition,
  segment,
}: Delimiters) => `UNA${component}${element}${decimal}${release}${repetition}${segment}`

const hasDefaultDelimiters = (delimiters: Delimiters) =>
  serviceStringAdvice(delimiters) === serviceStringAdvice(defaultDelimiters)

const noWhitespace: Whitespace = { lineBreaks: [], trailingText: '' }

export const serialize = ({
  hasServiceStringAdvice,
  delimiters,
  header,
  messages,
  trailer,
  whitespace = noWhitespace,
}: Interchange): string => {
  // Parse reads default delimiters when there is no UNA, so other delimiters need one to round-trip.
  const writesServiceStringAdvice = hasServiceStringAdvice || !hasDefaultDelimiters(delimiters)
  const firstSegment = writesServiceStringAdvice ? 2 : 1

  const segments = [
    header,
    ...messages.flatMap((message) => [message.header, ...message.segments, message.trailer]),
    trailer,
  ].map(
    (segment, index) =>
      (whitespace.lineBreaks[index] ?? '') +
      serializeSegment(segment, delimiters, firstSegment + index),
  )

  return (
    (writesServiceStringAdvice ? serviceStringAdvice(delimiters) : '') +
    segments.join('') +
    whitespace.trailingText
  )
}
