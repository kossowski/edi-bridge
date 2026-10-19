import { codeLists } from './definitions/code-lists'
import { compositeDirectory } from './definitions/composites'
import { dataElementFormats } from './definitions/data-elements'
import { messageDefinitions } from './definitions/message-definitions'
import { segmentDirectory } from './definitions/segments'
import { hasMessageIdentifier, messageIdentifierElement } from './message-identifier'
import {
  describePosition,
  interchangeSegmentPosition,
  messageEnvelopeSegments,
  type Position,
} from './position'

import type {
  ElementRef,
  MessageDefinition,
  Status,
  StructureEntry,
} from './definitions/definition'
import type { Delimiters, Interchange, Segment } from './model'

export type ValidationErrorCode =
  | 'invalid-character'
  | 'missing-element'
  | 'missing-segment'
  | 'too-long-element'
  | 'too-many-repetitions'
  | 'unexpected-element'
  | 'unexpected-segment'
  | 'unknown-code'
  | 'unsupported-message-type'
  | 'wrong-format'

export class ValidationError extends Error {
  override readonly name = 'ValidationError'

  constructor(
    readonly code: ValidationErrorCode,
    readonly position: Position,
  ) {
    super(`${code} at ${describePosition(position)}`)
  }
}

const findDefinition = (header: Segment) =>
  messageDefinitions.find(({ identifier }) => hasMessageIdentifier(header, identifier))

const formatPattern = /^(an|a|n)(?:\.\.)?(\d+)$/

interface ValueRule {
  status: Status
  numeric: boolean
  maxLength: number
  codes: ReadonlySet<string> | undefined
}

interface CompositeRule {
  status: Status
  components: ValueRule[]
}

const valueRuleOf = ({ id, status }: ElementRef): ValueRule => {
  const [, type, maxLength] = formatPattern.exec(dataElementFormats[id] ?? '') ?? []

  if (type === undefined || maxLength === undefined) {
    throw new Error(`Data element ${id} has no format`)
  }

  return { status, numeric: type === 'n', maxLength: Number(maxLength), codes: codeLists[id] }
}

const elementRuleOf = (ref: ElementRef): ValueRule | CompositeRule => {
  const components = compositeDirectory[ref.id]

  return components
    ? { status: ref.status, components: components.map(valueRuleOf) }
    : valueRuleOf(ref)
}

const segmentRules = new Map(
  Object.entries(segmentDirectory).map(([tag, refs]) => [tag, refs.map(elementRuleOf)]),
)

const digits = /^\d+$/

const isNumeric = (value: string, decimal: string) => {
  const [integer = '', fraction, ...rest] = value.replace(/^-/, '').split(decimal)

  return (
    rest.length === 0 && digits.test(integer) && (fraction === undefined || digits.test(fraction))
  )
}

const checkExtraValues = (
  values: string[],
  allowed: number,
  positionOf: (index: number) => Position,
) => {
  const extra = values.findIndex((value, index) => index >= allowed && value !== '')

  if (extra !== -1) {
    throw new ValidationError('unexpected-element', positionOf(extra))
  }
}

const isBundesbankReportingCode = (segment: Segment, { element, component }: Position) =>
  segment.tag === 'FTX' &&
  segment.elements[0]?.[0] === 'REG' &&
  element === 3 &&
  component === 2 &&
  segment.elements[2]?.[2] === '131'

const segmentChecker = ({ decimal }: Delimiters) => {
  const checkValue = (
    rule: ValueRule,
    value: string | undefined,
    position: Position,
    checkCode = true,
  ) => {
    if (!value) {
      if (rule.status === 'M') {
        throw new ValidationError('missing-element', position)
      }

      return
    }

    if (rule.numeric && !isNumeric(value, decimal)) {
      throw new ValidationError('wrong-format', position)
    }

    const length = rule.numeric ? value.replaceAll(/\D/g, '').length : value.length

    if (length > rule.maxLength) {
      throw new ValidationError('too-long-element', position)
    }

    if (checkCode && rule.codes?.has(value) === false) {
      throw new ValidationError('unknown-code', position)
    }
  }

  return (segment: Segment, position: Position) => {
    const rules = segmentRules.get(segment.tag) ?? []

    for (const [index, rule] of rules.entries()) {
      const values = segment.elements[index] ?? []
      const elementPosition = { ...position, element: index + 1 }

      const componentPosition = (componentIndex: number) => ({
        ...elementPosition,
        component: componentIndex + 1,
      })

      if (!('components' in rule)) {
        checkValue(rule, values[0], elementPosition)
        checkExtraValues(values, 1, componentPosition)

        continue
      }

      if (!values.some(Boolean)) {
        if (rule.status === 'M') {
          throw new ValidationError('missing-element', elementPosition)
        }

        continue
      }

      for (const [componentIndex, component] of rule.components.entries()) {
        const valuePosition = componentPosition(componentIndex)

        const checkCode = !isBundesbankReportingCode(segment, valuePosition)

        checkValue(component, values[componentIndex], valuePosition, checkCode)
      }

      checkExtraValues(values, rule.components.length, componentPosition)
    }

    checkExtraValues(
      segment.elements.map((values) => values.join('')),
      rules.length,
      (index) => ({ ...position, element: index + 1 }),
    )
  }
}

type SegmentCheck = ReturnType<typeof segmentChecker>

interface Cursor {
  segments: Segment[]
  index: number
  positionOf: (index: number) => Position
  checkSegment: SegmentCheck
}

const triggerOf = (entry: StructureEntry) => (entry.kind === 'segment' ? entry.tag : entry.trigger)

const matchEntries = (entries: StructureEntry[], cursor: Cursor, followingTags: Set<string>) => {
  for (const [index, entry] of entries.entries()) {
    const trigger = triggerOf(entry)
    const laterTags = new Set([...entries.slice(index + 1).map(triggerOf), ...followingTags])
    const tagsAfterGroupEntries = new Set([trigger, ...laterTags])
    let repetitions = 0

    let current = cursor.segments[cursor.index]

    while (current?.tag === trigger) {
      repetitions += 1

      if (repetitions > entry.maxRepetitions) {
        throw new ValidationError('too-many-repetitions', cursor.positionOf(cursor.index))
      }

      cursor.checkSegment(current, cursor.positionOf(cursor.index))
      cursor.index += 1

      if (entry.kind === 'group') {
        matchEntries(entry.entries, cursor, tagsAfterGroupEntries)
      }

      current = cursor.segments[cursor.index]
    }

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
  checkSegment: SegmentCheck,
) => {
  const cursor: Cursor = { segments, index: 0, positionOf, checkSegment }

  matchEntries(definition.segments, cursor, new Set())

  if (cursor.index < segments.length) {
    throw new ValidationError('unexpected-segment', cursor.positionOf(cursor.index))
  }
}

const levelA = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,-()/=\'+:?!"%&*;<>')

const levelB = new Set([...levelA, ...'abcdefghijklmnopqrstuvwxyz'])

const latin1 = /^[\u0020-\u007E\u00A0-\u00FF]$/u

// No repertoire is known for UNOD to UNOF, so their Interchanges skip the check.
const repertoires = new Map<string, (character: string) => boolean>([
  ['UNOA', (character) => levelA.has(character)],
  ['UNOB', (character) => levelB.has(character)],
  ['UNOC', (character) => latin1.test(character)],
])

const checkRepertoire = (interchange: Interchange, positionOf: (index: number) => Position) => {
  const inRepertoire = repertoires.get(interchange.header.elements[0]?.[0] ?? '')

  if (inRepertoire === undefined) {
    return
  }

  const segments = [
    interchange.header,
    ...interchange.messages.flatMap(({ header, segments, trailer }) => [
      header,
      ...segments,
      trailer,
    ]),
    interchange.trailer,
  ]

  for (const [index, { tag, elements }] of segments.entries()) {
    const rules = segmentRules.get(tag)

    for (const [elementIndex, values] of elements.entries()) {
      const rule = rules?.[elementIndex]
      const composite = rule === undefined || 'components' in rule

      for (const [componentIndex, value] of values.entries()) {
        const character = [...value].findIndex((found) => !inRepertoire(found))

        if (character !== -1) {
          const position: Position = { ...positionOf(index), element: elementIndex + 1 }

          if (composite) {
            position.component = componentIndex + 1
          }

          position.character = character + 1

          throw new ValidationError('invalid-character', position)
        }
      }
    }
  }
}

export const validate = (interchange: Interchange) => {
  const positionOf = interchangeSegmentPosition(interchange.hasServiceStringAdvice)

  checkRepertoire(interchange, positionOf)

  const checkSegment = segmentChecker(interchange.delimiters)
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

    validateMessage(
      definition,
      message.segments,
      (index) => positionOf(firstIndex + index),
      checkSegment,
    )

    headerIndex += message.segments.length + messageEnvelopeSegments
  }
}
