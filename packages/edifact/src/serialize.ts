import { defaultDelimiters, hasReleaseCharacter, serviceCharacters } from './delimiters'

import type { Delimiters, Interchange, Segment, Whitespace } from './model'

const releaseServiceCharacters = (value: string, delimiters: Delimiters) => {
  if (!hasReleaseCharacter(delimiters)) {
    return value
  }

  const released = new Set(serviceCharacters(delimiters))

  return [...value]
    .map((character) => (released.has(character) ? delimiters.release + character : character))
    .join('')
}

const serializeSegment = ({ tag, elements }: Segment, delimiters: Delimiters) =>
  [
    tag,
    ...elements.map((components) =>
      components
        .map((value) => releaseServiceCharacters(value, delimiters))
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

  const segments = [
    header,
    ...messages.flatMap((message) => [message.header, ...message.segments, message.trailer]),
    trailer,
  ].map(
    (segment, index) =>
      (whitespace.lineBreaks[index] ?? '') + serializeSegment(segment, delimiters),
  )

  return (
    (writesServiceStringAdvice ? serviceStringAdvice(delimiters) : '') +
    segments.join('') +
    whitespace.trailingText
  )
}
