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
  type MessageTypeStructure,
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

const fillsItself = (element: EdifactElement) => element.codes.length === 1

function valueOf(element: EdifactElement, values: Values) {
  return values.get(element.path) ?? (fillsItself(element) ? element.codes[0]!.code : '')
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
const isPresent = (part: StructurePart, values: Values) =>
  part.required || hasValueBeneath(part, values)

function firstMissingRequired(
  parts: ReadonlyArray<StructurePart>,
  values: Values,
): string | undefined {
  for (const part of parts) {
    if (part.kind === 'element') {
      if (part.required && !values.has(part.path) && !fillsItself(part)) {
        return part.path
      }

      continue
    }

    if (isPresent(part, values)) {
      const found = firstMissingRequired(childrenOf(part), values)

      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}

function segmentsOf(nodes: ReadonlyArray<EdifactStructureNode>, values: Values): Segment[] {
  return nodes.flatMap((node) => {
    if (!isPresent(node, values)) {
      return []
    }

    return node.kind === 'segmentGroup'
      ? segmentsOf(node.children, values)
      : [segmentOf(node, values)]
  })
}

function framed({ messageType, children }: MessageTypeStructure) {
  const [header, ...body] = children
  const trailer = body.pop()

  if (
    header?.kind !== 'segment' ||
    header.tag !== 'UNH' ||
    trailer?.kind !== 'segment' ||
    trailer.tag !== 'UNT'
  ) {
    throw new Error(`The ${messageType} structure does not run from UNH to UNT`)
  }

  return { header, body }
}

const messageReference = '1'

export function applyMappingVersion(
  version: OutboundMappingVersion,
  document: JsonContent,
): Effect.Effect<Message, MappingError> {
  const structure = messageTypeStructures[version.target.messageType]
  const { header, body } = framed(structure)
  const targets = new Set(elementPaths(body))
  const unknown = version.links.find(({ targetPath }) => !targets.has(targetPath))

  if (unknown) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown.targetPath }))
  }

  const values = new Map<string, string>()

  for (const { sourcePath, targetPath } of version.links) {
    const value = sourceValue(document, sourcePath)

    if (value !== undefined && value !== '') {
      values.set(targetPath, value)
    }
  }

  const missingTarget = firstMissingRequired(body, values)

  if (missingTarget !== undefined) {
    return Effect.fail(
      new MappingError({ code: 'missingRequiredValue', targetPath: missingTarget }),
    )
  }

  const segments = segmentsOf(body, values)

  return Effect.succeed({
    header: segmentOf(header, new Map([[`${header.path}/0062`, messageReference]])),
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  })
}
