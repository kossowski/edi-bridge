import { orders } from './definitions/orders'
import {
  describePosition,
  interchangeSegmentPosition,
  messageEnvelopeSegments,
  type Position,
} from './position'

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

const triggerOf = (entry: StructureEntry) => (entry.kind === 'segment' ? entry.tag : entry.trigger)

const matchEntries = (entries: StructureEntry[], cursor: Cursor, followingTags: Set<string>) => {
  for (const [index, entry] of entries.entries()) {
    const trigger = triggerOf(entry)
    const laterTags = new Set([...entries.slice(index + 1).map(triggerOf), ...followingTags])
    const tagsAfterGroupEntries = new Set([trigger, ...laterTags])
    let repetitions = 0

    while (cursor.segments[cursor.index]?.tag === trigger) {
      repetitions += 1

      if (repetitions > entry.maxRepetitions) {
        throw new ValidationError('too-many-repetitions', cursor.positionOf(cursor.index))
      }

      cursor.index += 1

      if (entry.kind === 'group') {
        matchEntries(entry.entries, cursor, tagsAfterGroupEntries)
      }
    }

    const current = cursor.segments[cursor.index]

    if (repetitions === 0 && entry.status === 'M') {
      throw new ValidationError(
        current === undefined || laterTags.has(current.tag)
          ? 'missing-segment'
          : 'unexpected-segment',
        cursor.positionOf(cursor.index),
      )
    }
  }
}

const validateMessage = (
  definition: MessageDefinition,
  segments: Segment[],
  positionOf: (index: number) => Position,
) => {
  const cursor: Cursor = { segments, index: 0, positionOf }

  matchEntries(definition.segments, cursor, new Set())

  if (cursor.index < segments.length) {
    throw new ValidationError('unexpected-segment', cursor.positionOf(cursor.index))
  }
}

export const validate = (interchange: Interchange) => {
  const positionOf = interchangeSegmentPosition(interchange.hasServiceStringAdvice)
  let headerIndex = 1

  for (const message of interchange.messages) {
    const definition = findDefinition(message.header)

    if (!definition) {
      throw new ValidationError('unsupported-message-type', {
        ...positionOf(headerIndex),
        element: messageIdentifierElement,
      })
    }

    const firstIndex = headerIndex + 1

    validateMessage(definition, message.segments, (index) => positionOf(firstIndex + index))

    headerIndex += message.segments.length + messageEnvelopeSegments
  }
}
