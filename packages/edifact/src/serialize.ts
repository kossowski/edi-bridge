import type { Delimiters, Interchange, Segment } from './parse'

const noReleaseCharacter = ' '

const releaseServiceCharacters = (value: string, delimiters: Delimiters) => {
  const { component, element, release, segment } = delimiters

  if (release === noReleaseCharacter) {
    return value
  }

  const serviceCharacters = new Set([component, element, release, segment])

  return [...value]
    .map((character) => (serviceCharacters.has(character) ? release + character : character))
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

export const serialize = ({
  hasServiceStringAdvice,
  delimiters,
  header,
  messages,
  trailer,
  layout,
}: Interchange): string => {
  const segments = [
    header,
    ...messages.flatMap((message) => [message.header, ...message.segments, message.trailer]),
    trailer,
  ].map((segment) => serializeSegment(segment, delimiters))

  return (
    [...(hasServiceStringAdvice ? [serviceStringAdvice(delimiters)] : []), ...segments].join(
      layout.lineBreak,
    ) + layout.trailingText
  )
}
