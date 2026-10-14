import { orders } from './definitions/orders'
import { describePosition, type Position } from './position'

import type { MessageDefinition, StructureEntry } from './definitions/definition'
import type { Interchange, Segment } from './model'

export type ValidationErrorCode =
  'missing-segment' | 'too-many-repetitions' | 'unexpected-segment' | 'unsupported-message-type'

export class ValidationError extends Error {
  override readonly name = 'ValidationError'

  constructor(
    readonly code: ValidationErrorCode,
    readonly position: Position,
  ) {
    super(`${code} at ${describePosition(position)}`)
  }
}

const definitions = [orders]

const messageIdentifierElement = 2

const findDefinition = (header: Segment) => {
  const [type, version, release, controllingAgency] =
    header.elements[messageIdentifierElement - 1] ?? []

  return definitions.find(
    ({ identifier }) =>
      identifier.type === type &&
      identifier.version === version &&
      identifier.release === release &&
      identifier.controllingAgency === controllingAgency,
  )
}

interface Cursor {
  segments: Segment[]
  index: number
  positionOf: (index: number) => Position
}

const triggerOf = (entry: StructureEntry) =>
  'segment' in entry ? entry.segment : entry.entries[0].segment

// A segment that fits a later entry means the mandatory entry is missing; any other segment is out of place.
const matchEntries = (entries: StructureEntry[], cursor: Cursor, laterTags: Set<string>) => {
  for (const [index, entry] of entries.entries()) {
    const trigger = triggerOf(entry)
    let repetitions = 0

    while (cursor.segments[cursor.index]?.tag === trigger) {
      repetitions += 1

      if (repetitions > entry.maxRepetitions) {
        throw new ValidationError('too-many-repetitions', cursor.positionOf(cursor.index))
      }

      cursor.index += 1

      if (!('segment' in entry)) {
        matchEntries(
          entry.entries.slice(1),
          cursor,
          new Set([...entries.slice(index).map(triggerOf), ...laterTags]),
        )
      }
    }

    const current = cursor.segments[cursor.index]

    if (repetitions === 0 && entry.status === 'M') {
      const fitsLater =
        current === undefined ||
        entries.slice(index + 1).some((later) => triggerOf(later) === current.tag) ||
        laterTags.has(current.tag)

      throw new ValidationError(
        fitsLater ? 'missing-segment' : 'unexpected-segment',
        cursor.positionOf(cursor.index),
      )
    }
  }
}

const validateMessage = (
  definition: MessageDefinition,
  segments: Segment[],
  firstSegment: number,
) => {
  const cursor: Cursor = {
    segments,
    index: 0,
    positionOf: (index) => ({ segment: firstSegment + index }),
  }

  matchEntries(definition.structure, cursor, new Set())

  if (cursor.index < segments.length) {
    throw new ValidationError('unexpected-segment', cursor.positionOf(cursor.index))
  }
}

export const validate = (interchange: Interchange) => {
  let headerSegment = (interchange.hasServiceStringAdvice ? 1 : 0) + 2

  for (const message of interchange.messages) {
    const definition = findDefinition(message.header)

    if (!definition) {
      throw new ValidationError('unsupported-message-type', {
        segment: headerSegment,
        element: messageIdentifierElement,
      })
    }

    validateMessage(definition, message.segments, headerSegment + 1)

    headerSegment += message.segments.length + 2
  }
}
