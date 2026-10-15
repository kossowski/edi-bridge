import { Effect } from 'effect'

import {
  arrayBasePath,
  type EdifactElement,
  type EdifactSegment,
  type EdifactSegmentGroup,
  type EdifactStructureNode,
  type JsonContent,
  type MappingVersion,
  type MessageTypeStructure,
  messageTypeStructures,
} from '@edi-bridge/contracts'

import type { Element, Message, Segment } from '@edi-bridge/edifact'

import { childrenOf, elementPaths, type StructurePart } from './elements'
import { MappingError } from './errors'
import {
  type EvaluatedGraph,
  evaluated,
  targetValues,
  transformReads,
  type Value,
  valueSchema,
} from './evaluation'
import { jsonListSchema, jsonObjectSchema } from './json'
import { isBeneath, isRequiredOrFilled, setFilled, type Values } from './values'
import { type Loop, type Wiring, wiringOf } from './wiring'

import type { ApplyOptions } from './options'

export type OutboundMappingVersion = Extract<MappingVersion, { direction: 'outbound' }>

type Scope = {
  items: ReadonlyMap<string, JsonContent>
  counters: ReadonlyMap<string, string>
}

type Context = {
  document: JsonContent
  links: OutboundMappingVersion['links']
  graph: EvaluatedGraph
  loops: ReadonlyMap<string, Loop>
  itemCounts: Map<Loop, number>
  scope: Scope
  values: Values
}

type Reading = Omit<Context, 'values'>

function read({ document, scope }: Reading, path: string): JsonContent | undefined {
  const bound = [...scope.items.keys()]
    .filter((part) => isBeneath(path, part, '.'))
    .reduce<string | undefined>(
      (longest, part) => (longest === undefined || part.length > longest.length ? part : longest),
      undefined,
    )

  const rest = bound === undefined ? path : path.slice(bound.length + 1)
  let value: JsonContent | undefined = bound === undefined ? document : scope.items.get(bound)

  for (const key of rest === '' ? [] : rest.split('.')) {
    const object = jsonObjectSchema.safeParse(value)

    value = object.success && !key.endsWith('[]') ? object.data[key] : undefined
  }

  return value
}

function scalarOf(context: Reading, path: string): Value | undefined {
  const scalar = valueSchema.safeParse(read(context, path))

  return scalar.success ? scalar.data : undefined
}

function sourceValue(context: Reading, path: string): string | undefined {
  const scalar = scalarOf(context, path)

  return scalar === undefined ? undefined : String(scalar)
}

function itemsOf(context: Reading, sourcePart: string): JsonContent[] {
  const items = jsonListSchema.safeParse(read(context, arrayBasePath(sourcePart)))

  return items.success ? items.data : []
}

function valuesIn(context: Reading): Effect.Effect<Values, MappingError> {
  const values = new Map<string, string>()

  for (const { sourcePath, targetPath } of context.links) {
    setFilled(values, targetPath, sourceValue(context, sourcePath))
  }

  return targetValues(
    {
      graph: context.graph,
      counters: context.scope.counters,
      read: (sourcePath) => scalarOf(context, sourcePath),
    },
    values,
  )
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

function groupPaths(nodes: ReadonlyArray<EdifactStructureNode>): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'segmentGroup' ? [node.path, ...groupPaths(node.children)] : [],
  )
}

function unknownTarget(
  links: OutboundMappingVersion['links'],
  { graph, loopTargets }: Wiring,
  body: ReadonlyArray<EdifactStructureNode>,
): string | undefined {
  const elements = new Set(elementPaths(body))
  const groups = new Set(groupPaths(body))

  return (
    loopTargets.find((path) => !groups.has(path)) ??
    [...links.map(({ targetPath }) => targetPath), ...graph.targets.map(({ path }) => path)].find(
      (path) => !elements.has(path),
    )
  )
}

function repeatingParts(sourcePath: string): string[] {
  const keys = sourcePath.split('.')

  return keys.flatMap((key, index) =>
    key.endsWith('[]') ? [keys.slice(0, index + 1).join('.')] : [],
  )
}

function outsideLoop(
  links: OutboundMappingVersion['links'],
  { graph, loops }: Wiring,
): string | undefined {
  return [...links, ...transformReads(graph)].find(({ sourcePath, targetPath }) =>
    repeatingParts(sourcePath).some(
      (part) =>
        ![...loops].some(
          ([targetPart, loop]) => loop.sourcePart === part && isBeneath(targetPath, targetPart),
        ),
    ),
  )?.targetPath
}

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

    if (isRequiredOrFilled(part, values)) {
      const found = firstMissingRequired(childrenOf(part), values)

      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}

const missing = (targetPath: string) =>
  new MappingError({ code: 'missingRequiredValue', targetPath })

const hasItemsBeneath = (part: StructurePart, context: Context) =>
  [...context.loops].some(
    ([targetPart, { sourcePart }]) =>
      isBeneath(targetPart, part.path) && itemsOf(context, sourcePart).length > 0,
  )

// An empty optional segment group is left out rather than failing.
const isPresent = (part: StructurePart, context: Context) =>
  isRequiredOrFilled(part, context.values) || hasItemsBeneath(part, context)

function within(
  context: Context,
  loop: Loop,
  item: JsonContent,
): Effect.Effect<Context, MappingError> {
  const itemCount = context.itemCounts.get(loop) ?? 0

  context.itemCounts.set(loop, itemCount + 1)

  const scope = {
    items: new Map(context.scope.items).set(loop.sourcePart, item),
    counters: new Map(context.scope.counters).set(loop.id, String(loop.counterStart + itemCount)),
  }

  return Effect.map(valuesIn({ ...context, scope }), (values) => ({ ...context, scope, values }))
}

function loopSegments(
  group: EdifactSegmentGroup,
  loop: Loop,
  context: Context,
): Effect.Effect<Segment[], MappingError> {
  const items = itemsOf(context, loop.sourcePart)

  // Header fields linked beneath the group would fill it, so they must not count without items.
  if (items.length === 0) {
    const found = group.required ? firstMissingRequired(group.children, new Map()) : undefined

    return found === undefined ? Effect.succeed([]) : Effect.fail(missing(found))
  }

  return Effect.map(
    Effect.forEach(items, (item) =>
      Effect.flatMap(within(context, loop, item), (inner) => segmentsOf(group.children, inner)),
    ),
    (repetitions) => repetitions.flat(),
  )
}

function segmentsOf(
  nodes: ReadonlyArray<EdifactStructureNode>,
  context: Context,
): Effect.Effect<Segment[], MappingError> {
  return Effect.map(
    Effect.forEach(nodes, (node): Effect.Effect<Segment[], MappingError> => {
      const loop = context.loops.get(node.path)

      if (node.kind === 'segmentGroup' && loop) {
        return loopSegments(node, loop, context)
      }

      if (!isPresent(node, context)) {
        return Effect.succeed([])
      }

      if (node.kind === 'segmentGroup') {
        return segmentsOf(node.children, context)
      }

      const found = firstMissingRequired(node.children, context.values)

      return found === undefined
        ? Effect.succeed([segmentOf(node, context.values)])
        : Effect.fail(missing(found))
    }),
    (lists) => lists.flat(),
  )
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
  options: ApplyOptions = {},
): Effect.Effect<Message, MappingError> {
  const structure = messageTypeStructures[version.target.messageType]
  const { header, body } = framed(structure)
  const wiring = wiringOf(version, options.lookupTables)
  const { graph, loops } = wiring
  const unknown = unknownTarget(version.links, wiring, body)

  if (unknown !== undefined) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown }))
  }

  const outside = outsideLoop(version.links, wiring)

  if (outside !== undefined) {
    return Effect.fail(new MappingError({ code: 'outsideLoop', targetPath: outside }))
  }

  return Effect.flatMap(evaluated(graph, document), (evaluatedGraph) => {
    const reading: Reading = {
      document,
      links: version.links,
      graph: evaluatedGraph,
      loops,
      itemCounts: new Map(),
      scope: { items: new Map(), counters: new Map() },
    }

    return Effect.map(
      Effect.flatMap(valuesIn(reading), (values) => segmentsOf(body, { ...reading, values })),
      (segments) => ({
        header: segmentOf(header, new Map([[`${header.path}/0062`, messageReference]])),
        segments,
        trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
      }),
    )
  })
}
