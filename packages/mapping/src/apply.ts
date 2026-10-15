import { Data, Effect } from 'effect'
import { z } from 'zod'

import {
  type EdifactComposite,
  type EdifactElement,
  type EdifactSegment,
  type EdifactStructureNode,
  type JsonContent,
  jsonContentSchema,
  type MappingVersion,
  messageTypeStructures,
} from '@edi-bridge/contracts'

import type { Element, Message, Segment } from '@edi-bridge/edifact'

export type OutboundMappingVersion = Extract<MappingVersion, { direction: 'outbound' }>

export type MappingErrorCode = 'missingRequiredValue' | 'unknownTarget'

export class MappingError extends Data.TaggedError('MappingError')<{
  readonly code: MappingErrorCode
  readonly targetPath: string
}> {}

type Values = ReadonlyMap<string, string>

const objectSchema = z.record(z.string(), jsonContentSchema)

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

function sourceValue(document: JsonContent, path: string): string | undefined {
  let value: JsonContent | undefined = document

  for (const key of path.split('.')) {
    const object = objectSchema.safeParse(value)

    value = object.success ? object.data[key] : undefined
  }

  const scalar = scalarSchema.safeParse(value)

  return scalar.success ? String(scalar.data) : undefined
}

function trimmed<Part>(parts: ReadonlyArray<Part>, empty: (part: Part) => boolean): Part[] {
  return parts.slice(0, parts.findLastIndex((part) => !empty(part)) + 1)
}

function valueOf(element: EdifactElement, values: Values) {
  return values.get(element.path) ?? (element.codes.length === 1 ? element.codes[0]!.code : '')
}

function segmentOf(segment: EdifactSegment, values: Values): Segment {
  const elements = segment.children.map((child): Element => {
    if (child.kind === 'element') {
      return [valueOf(child, values)]
    }

    const components = trimmed(
      child.children.map((element) => valueOf(element, values)),
      (value) => value === '',
    )

    return components.length === 0 ? [''] : components
  })

  return {
    tag: segment.tag,
    elements: trimmed(elements, (element) => element.every((value) => value === '')),
  }
}

type StructurePart =
  EdifactStructureNode | EdifactSegment['children'][number] | EdifactComposite['children'][number]

const childrenOf = (part: StructurePart): ReadonlyArray<StructurePart> =>
  part.kind === 'element' ? [] : part.children

function elementPaths(parts: ReadonlyArray<StructurePart>): string[] {
  return parts.flatMap((part) =>
    part.kind === 'element' ? [part.path] : elementPaths(childrenOf(part)),
  )
}

const hasValueBeneath = (part: StructurePart, values: Values) =>
  [...values.keys()].some((path) => path.startsWith(`${part.path}/`))

// An empty optional segment group is left out rather than failing.
function firstMissingRequired(
  parts: ReadonlyArray<StructurePart>,
  values: Values,
  missing: ReadonlySet<string>,
): string | undefined {
  for (const part of parts) {
    if (part.kind === 'element') {
      if (part.required && missing.has(part.path)) {
        return part.path
      }

      continue
    }

    if (part.required || hasValueBeneath(part, values)) {
      const found = firstMissingRequired(childrenOf(part), values, missing)

      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}

const framingTags = new Set(['UNH', 'UNS', 'UNT'])

function segmentsOf(nodes: ReadonlyArray<EdifactStructureNode>, values: Values): Segment[] {
  return nodes.flatMap((node) => {
    const filled = hasValueBeneath(node, values)

    if (node.kind === 'segmentGroup') {
      return filled ? segmentsOf(node.children, values) : []
    }

    return filled || framingTags.has(node.tag) ? [segmentOf(node, values)] : []
  })
}

const messageReference = '1'

export function applyMappingVersion(
  version: OutboundMappingVersion,
  document: JsonContent,
): Effect.Effect<Message, MappingError> {
  const structure = messageTypeStructures[version.target.messageType]
  const targets = new Set(elementPaths(structure.children))
  const unknown = version.links.find(({ targetPath }) => !targets.has(targetPath))

  if (unknown) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown.targetPath }))
  }

  const values = new Map<string, string>()
  const missing = new Set<string>()

  for (const { sourcePath, targetPath } of version.links) {
    const value = sourceValue(document, sourcePath)

    if (value === undefined || value === '') {
      missing.add(targetPath)
    } else {
      values.set(targetPath, value)
    }
  }

  const missingTarget = firstMissingRequired(structure.children, values, missing)

  if (missingTarget !== undefined) {
    return Effect.fail(
      new MappingError({ code: 'missingRequiredValue', targetPath: missingTarget }),
    )
  }

  values.set('UNH/0062', messageReference)

  // Every Message Type starts with UNH and ends with UNT, which counts the segments it encloses.
  const [header, ...rest] = segmentsOf(structure.children, values)
  const segments = rest.slice(0, -1)

  return Effect.succeed({
    header: header!,
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  })
}
