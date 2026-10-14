import type { Delimiters } from './model'

export const defaultDelimiters: Delimiters = {
  component: ':',
  element: '+',
  decimal: '.',
  release: '?',
  repetition: ' ',
  segment: "'",
}

const noReleaseCharacter = ' '

export const hasReleaseCharacter = ({ release }: Delimiters) => release !== noReleaseCharacter

// Parse accepts a release character only before these, and serialize releases exactly these.
export const serviceCharacters = (delimiters: Delimiters) => {
  const { component, element, release, segment } = delimiters

  return hasReleaseCharacter(delimiters)
    ? [component, element, segment, release]
    : [component, element, segment]
}
