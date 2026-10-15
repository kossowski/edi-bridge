import { Effect } from 'effect'

import {
  type DocumentField,
  type DocumentStructure,
  type DocumentStructureNode,
  documentStructureNodes,
  type EdifactSegment,
  type EdifactStructureNode,
  type JsonContent,
  type MappingVersion,
  messageTypeStructures,
  nodeContent,
} from '@edi-bridge/contracts'

import type { Message, Segment } from '@edi-bridge/edifact'

import { elementPaths } from './elements'
import { MappingError } from './errors'
import { isRequiredOrFilled, setFilled, type Values } from './values'

export type InboundMappingVersion = Extract<MappingVersion, { direction: 'inbound' }>

type Occurrences = {
  segments: Map<string, Segment[]>
  groups: Map<string, Occurrences[]>
}

// Every qualifier of the EANCOM directory is the first value of its segment.
const matches = (node: EdifactSegment, segment: Segment) =>
  node.tag === segment.tag &&
  (node.qualifier === null || segment.elements[0]?.[0] === node.qualifier.code)

function entryOf(node: EdifactStructureNode): EdifactSegment {
  const [first] = node.kind === 'segment' ? [node] : node.children

  if (first?.kind !== 'segment') {
    throw new Error(`The segment group ${node.path} does not start with a segment`)
  }

  return first
}

function segmentNodes(nodes: ReadonlyArray<EdifactStructureNode>): EdifactSegment[] {
  return nodes.flatMap((node) => (node.kind === 'segment' ? [node] : segmentNodes(node.children)))
}

type MessageSegments = {
  segments: ReadonlyArray<Segment>
  isInStructure: (segment: Segment) => boolean
}

type PlaceResult = { occurrences: Occurrences; next: number }

const countOf = (occurrences: Occurrences, node: EdifactStructureNode) =>
  (node.kind === 'segment' ? occurrences.segments : occurrences.groups).get(node.path)?.length ?? 0

// A segment placed at a higher level closes the open segment groups instead of being skipped.
function place(
  nodes: ReadonlyArray<EdifactStructureNode>,
  { segments, isInStructure }: MessageSegments,
  start: number,
  outermost = false,
): PlaceResult {
  const occurrences: Occurrences = { segments: new Map(), groups: new Map() }
  let index = start
  let position = 0

  while (index < segments.length) {
    const segment = segments[index]!

    const found = nodes.findIndex(
      (node, at) =>
        at >= position &&
        countOf(occurrences, node) < node.maxRepeat &&
        matches(entryOf(node), segment),
    )

    if (found === -1) {
      if (outermost || !isInStructure(segment)) {
        index += 1
        continue
      }

      break
    }

    position = found
    const node = nodes[found]!

    if (node.kind === 'segment') {
      occurrences.segments.set(node.path, [...(occurrences.segments.get(node.path) ?? []), segment])
      index += 1
      continue
    }

    const inner = place(node.children, { segments, isInStructure }, index)

    occurrences.groups.set(node.path, [
      ...(occurrences.groups.get(node.path) ?? []),
      inner.occurrences,
    ])
    index = inner.next
  }

  return { occurrences, next: index }
}

type SegmentChild = EdifactSegment['children'][number]

function componentOf(child: SegmentChild, path: string): number {
  if (child.kind === 'composite') {
    return child.children.findIndex((element) => element.path === path)
  }

  return child.path === path ? 0 : -1
}

// A plain link reads the first repetition of a segment or segment group.
function valueAt(
  occurrences: Occurrences,
  nodes: ReadonlyArray<EdifactStructureNode>,
  path: string,
): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'segmentGroup') {
      const [first] = occurrences.groups.get(node.path) ?? []
      const found = first && valueAt(first, node.children, path)

      if (found !== undefined) {
        return found
      }

      continue
    }

    const [segment] = occurrences.segments.get(node.path) ?? []

    for (const [index, child] of node.children.entries()) {
      const component = componentOf(child, path)

      if (component !== -1) {
        return segment?.elements[index]?.[component]
      }
    }
  }

  return undefined
}

type JsonObject = Record<string, JsonContent>

const numberPattern = /^-?\d+(?:[.,]\d+)?$/

function fieldValue(field: DocumentField, value: string): Effect.Effect<JsonContent, MappingError> {
  if (field.type !== 'number' && field.type !== 'integer') {
    return Effect.succeed(value)
  }

  const number = Number(value.replace(',', '.'))

  return numberPattern.test(value) && (field.type === 'number' || Number.isInteger(number))
    ? Effect.succeed(number)
    : Effect.fail(new MappingError({ code: 'invalidNumber', targetPath: field.path }))
}

// Only an object that is required or holds a value needs its required fields.
function documentOf(
  nodes: ReadonlyArray<DocumentStructureNode>,
  values: Values,
): Effect.Effect<JsonObject, MappingError> {
  return Effect.map(
    Effect.forEach(nodes, (node): Effect.Effect<Array<[string, JsonContent]>, MappingError> => {
      if (node.kind === 'field') {
        const value = values.get(node.path)

        if (value === undefined) {
          return node.required
            ? Effect.fail(new MappingError({ code: 'missingRequiredValue', targetPath: node.path }))
            : Effect.succeed([])
        }

        return Effect.map(fieldValue(node, value), (content) => [[node.name, content]])
      }

      if (node.kind === 'object' && isRequiredOrFilled(node, values, '.')) {
        return Effect.map(documentOf(node.children, values), (content) => [[node.name, content]])
      }

      return Effect.succeed([])
    }),
    (entries) => Object.fromEntries(entries.flat()),
  )
}

export function applyInboundMappingVersion(
  version: InboundMappingVersion,
  structure: DocumentStructure,
  message: Message,
): Effect.Effect<JsonContent, MappingError> {
  const { children } = messageTypeStructures[version.source.messageType]

  const fields = new Set(
    [...documentStructureNodes(structure.children)].flatMap(({ node }) =>
      nodeContent(node).kind === 'field' ? [node.path] : [],
    ),
  )

  const elements = new Set(elementPaths(children))

  for (const { sourcePath, targetPath } of version.links) {
    if (!elements.has(sourcePath)) {
      return Effect.fail(new MappingError({ code: 'unknownSource', targetPath, sourcePath }))
    }

    if (!fields.has(targetPath)) {
      return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath }))
    }
  }

  const structureSegments = segmentNodes(children)

  const { occurrences } = place(
    children,
    {
      segments: [message.header, ...message.segments, message.trailer],
      isInStructure: (segment) => structureSegments.some((node) => matches(node, segment)),
    },
    0,
    true,
  )

  const values = new Map<string, string>()

  for (const { sourcePath, targetPath } of version.links) {
    setFilled(values, targetPath, valueAt(occurrences, children, sourcePath))
  }

  return documentOf(structure.children, values)
}
