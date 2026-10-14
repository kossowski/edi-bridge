// Consumers highlight the raw Interchange with it: indexes start at 1, a UNA is segment 1, element 1 follows the tag.
export interface Position {
  segment: number
  element?: number
  component?: number
}

export const describePosition = ({ segment, element, component }: Position) =>
  [
    `segment ${segment}`,
    element === undefined ? undefined : `element ${element}`,
    component === undefined ? undefined : `component ${component}`,
  ]
    .filter(Boolean)
    .join(', ')

export const messageEnvelopeSegments = 2

export const interchangeSegmentPosition =
  (hasServiceStringAdvice: boolean) =>
  (index: number): Position => ({ segment: (hasServiceStringAdvice ? 1 : 0) + index + 1 })
