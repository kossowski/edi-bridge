import { Effect } from 'effect'

import {
  type DocumentArray,
  type DocumentField,
  type DocumentObject,
  type DocumentStructure,
  type DocumentStructureNode,
  documentStructureNodes,
  type EdifactSegment,
  type EdifactSegmentGroup,
  type EdifactStructureNode,
  type JsonContent,
  type MappingVersion,
  messageTypeStructures,
  nodeContent,
} from '@edi-bridge/contracts'

import type { Message, Segment } from '@edi-bridge/edifact'

import { elementPaths } from './elements'
import { MappingError } from './errors'
import { hasValueBeneath, isBeneath, isRequiredOrFilled, setFilled, type Values } from './values'
import { type Loop, type Wiring, wiringOf } from './wiring'

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

type Located = { occurrences: Occurrences; nodes: ReadonlyArray<EdifactStructureNode> }

// Outside the scope of a loop, a plain link reads the first repetition of a segment or group.
function valueAt({ occurrences, nodes }: Located, path: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'segmentGroup') {
      const [first] = occurrences.groups.get(node.path) ?? []
      const found = first && valueAt({ occurrences: first, nodes: node.children }, path)

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

function repetitionsOf({ occurrences, nodes }: Located, path: string): Occurrences[] {
  for (const node of nodes) {
    if (node.kind !== 'segmentGroup' || !isBeneath(path, node.path)) {
      continue
    }

    const repetitions = occurrences.groups.get(node.path) ?? []
    const [first] = repetitions

    if (node.path === path) {
      return repetitions
    }

    return first ? repetitionsOf({ occurrences: first, nodes: node.children }, path) : []
  }

  return []
}

function groupsOf(nodes: ReadonlyArray<EdifactStructureNode>): EdifactSegmentGroup[] {
  return nodes.flatMap((node) =>
    node.kind === 'segmentGroup' ? [node, ...groupsOf(node.children)] : [],
  )
}

type Scope = {
  repetitions: ReadonlyMap<string, Occurrences>
  counters: ReadonlyMap<string, string>
  loopTargets: ReadonlySet<string>
}

type Reading = {
  message: Located
  groups: ReadonlyMap<string, EdifactSegmentGroup>
  links: InboundMappingVersion['links']
  graph: Wiring['graph']
  loops: ReadonlyMap<string, Loop>
  numbered: Map<Loop, number>
  scope: Scope
}

type Context = Reading & { values: Values }

function located({ message, groups, scope }: Reading, path: string): Located {
  const part = [...scope.repetitions.keys()]
    .filter((group) => group !== path && isBeneath(path, group))
    .reduce<string | undefined>(
      (longest, group) =>
        longest === undefined || group.length > longest.length ? group : longest,
      undefined,
    )

  return part === undefined
    ? message
    : { occurrences: scope.repetitions.get(part)!, nodes: groups.get(part)!.children }
}

// A link beneath a loop's target part only holds a value in the scope of one of its items.
const isInScope = ({ loops, scope }: Reading, targetPath: string) =>
  [...loops.keys()].every(
    (targetPart) => !isBeneath(targetPath, targetPart, '.') || scope.loopTargets.has(targetPart),
  )

function valuesIn(reading: Reading): Effect.Effect<Values, MappingError> {
  const values = new Map<string, string>()

  for (const { sourcePath, targetPath } of reading.links) {
    if (isInScope(reading, targetPath)) {
      setFilled(values, targetPath, valueAt(located(reading, sourcePath), sourcePath))
    }
  }

  for (const { path, from } of reading.graph.targets) {
    const transform = reading.graph.transforms.get(from.transformId)

    if (transform?.kind !== 'loop' || !isInScope(reading, path)) {
      continue
    }

    if (!reading.graph.valid.has(transform.id)) {
      return Effect.fail(
        new MappingError({ code: 'invalidTransform', targetPath: path, transformId: transform.id }),
      )
    }

    setFilled(values, path, reading.scope.counters.get(transform.id))
  }

  return Effect.succeed(values)
}

function within(
  context: Context,
  loop: Loop,
  targetPart: string,
  repetition: Occurrences,
): Effect.Effect<Context, MappingError> {
  const numbered = context.numbered.get(loop) ?? 0

  context.numbered.set(loop, numbered + 1)

  const scope = {
    repetitions: new Map(context.scope.repetitions).set(loop.sourcePart, repetition),
    counters: new Map(context.scope.counters).set(loop.id, String(loop.counterStart + numbered)),
    loopTargets: new Set(context.scope.loopTargets).add(targetPart),
  }

  const reading = { ...context, scope }

  return Effect.map(valuesIn(reading), (values) => ({ ...reading, values }))
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

type Entries = Effect.Effect<Array<[string, JsonContent]>, MappingError>

function fieldEntry(field: DocumentField, values: Values): Entries {
  const value = values.get(field.path)

  if (value === undefined) {
    return field.required
      ? Effect.fail(new MappingError({ code: 'missingRequiredValue', targetPath: field.path }))
      : Effect.succeed([])
  }

  return Effect.map(fieldValue(field, value), (content) => [[field.name, content]])
}

function itemOf(
  content: DocumentField | DocumentObject,
  context: Context,
): Effect.Effect<JsonContent, MappingError> {
  return content.kind === 'field'
    ? Effect.map(fieldEntry(content, context.values), (entries) => entries[0]?.[1] ?? null)
    : documentOf(content.children, context)
}

function arrayEntry(node: DocumentArray, context: Context): Entries {
  const loop = context.loops.get(node.path)
  const repetitions = loop ? repetitionsOf(located(context, loop.sourcePart), loop.sourcePart) : []

  if (loop && repetitions.length > 0) {
    return Effect.map(
      Effect.forEach(repetitions, (repetition) =>
        Effect.flatMap(within(context, loop, node.path, repetition), (inner) =>
          itemOf(node.items, inner),
        ),
      ),
      (items) => [[node.name, items]],
    )
  }

  if (hasValueBeneath(node, context.values, '.')) {
    return Effect.map(itemOf(node.items, context), (item) => [[node.name, [item]]])
  }

  // A required array is written empty, as JSON asks only for the key.
  return Effect.succeed(node.required ? [[node.name, []]] : [])
}

const hasItemsBeneath = (part: DocumentObject, context: Context) =>
  [...context.loops].some(
    ([targetPart, { sourcePart }]) =>
      isBeneath(targetPart, part.path, '.') &&
      repetitionsOf(located(context, sourcePart), sourcePart).length > 0,
  )

// Only an object that is required or holds a value needs its required fields.
function documentOf(
  nodes: ReadonlyArray<DocumentStructureNode>,
  context: Context,
): Effect.Effect<JsonObject, MappingError> {
  return Effect.map(
    Effect.forEach(nodes, (node): Entries => {
      switch (node.kind) {
        case 'field':
          return fieldEntry(node, context.values)
        case 'object':
          return isRequiredOrFilled(node, context.values, '.') || hasItemsBeneath(node, context)
            ? Effect.map(documentOf(node.children, context), (content) => [[node.name, content]])
            : Effect.succeed([])
        case 'array':
          return arrayEntry(node, context)
      }
    }),
    (entries) => Object.fromEntries(entries.flat()),
  )
}

type Read = { sourcePath: string; targetPath: string }

function unknownRead(
  links: ReadonlyArray<Read>,
  { graph, loops, loopTargets }: Wiring,
  nodes: ReadonlyArray<EdifactStructureNode>,
  structure: DocumentStructure,
): MappingError | undefined {
  const documentNodes = [...documentStructureNodes(structure.children)].map(({ node }) => node)

  const fields = new Set(
    documentNodes.flatMap((node) => (nodeContent(node).kind === 'field' ? [node.path] : [])),
  )

  const arrays = new Set(
    documentNodes.flatMap(({ kind, path }) => (kind === 'array' ? [path] : [])),
  )

  const elements = new Set(elementPaths(nodes))
  const groups = new Set(groupsOf(nodes).map(({ path }) => path))

  const unknownSource = [
    ...links.map((read) => ({ ...read, known: elements })),
    ...[...loops].map(([targetPath, { sourcePart }]) => ({
      sourcePath: sourcePart,
      targetPath,
      known: groups,
    })),
  ].find(({ sourcePath, known }) => !known.has(sourcePath))

  if (unknownSource) {
    const { sourcePath, targetPath } = unknownSource

    return new MappingError({ code: 'unknownSource', targetPath, sourcePath })
  }

  const targetPath =
    loopTargets.find((path) => !arrays.has(path)) ??
    [...links.map((read) => read.targetPath), ...graph.targets.map(({ path }) => path)].find(
      (path) => !fields.has(path),
    )

  return targetPath === undefined
    ? undefined
    : new MappingError({ code: 'unknownTarget', targetPath })
}

// A loop over a nested segment group reads it from the repetition of its parent's loop.
function outsideLoop(
  links: ReadonlyArray<Read>,
  loops: ReadonlyMap<string, Loop>,
  groups: ReadonlyArray<EdifactSegmentGroup>,
): string | undefined {
  const repeating = groups.flatMap(({ maxRepeat, path }) => (maxRepeat > 1 ? [path] : []))

  const reads = [
    ...links,
    ...[...loops].map(([targetPart, { sourcePart }]) => ({
      sourcePath: sourcePart,
      targetPath: targetPart,
    })),
  ]

  return reads.find(({ sourcePath, targetPath }) =>
    repeating.some(
      (part) =>
        part !== sourcePath &&
        isBeneath(sourcePath, part) &&
        ![...loops].some(
          ([targetPart, loop]) =>
            loop.sourcePart === part && isBeneath(targetPath, targetPart, '.'),
        ),
    ),
  )?.targetPath
}

export function applyInboundMappingVersion(
  version: InboundMappingVersion,
  structure: DocumentStructure,
  message: Message,
): Effect.Effect<JsonContent, MappingError> {
  const { children } = messageTypeStructures[version.source.messageType]

  const wiring = wiringOf(version)
  const { graph, loops } = wiring
  const groups = groupsOf(children)
  const unknown = unknownRead(version.links, wiring, children, structure)

  if (unknown) {
    return Effect.fail(unknown)
  }

  const outside = outsideLoop(version.links, loops, groups)

  if (outside !== undefined) {
    return Effect.fail(new MappingError({ code: 'outsideLoop', targetPath: outside }))
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

  const reading: Reading = {
    message: { occurrences, nodes: children },
    groups: new Map(groups.map((group) => [group.path, group])),
    links: version.links,
    graph,
    loops,
    numbered: new Map(),
    scope: { repetitions: new Map(), counters: new Map(), loopTargets: new Set() },
  }

  return Effect.flatMap(valuesIn(reading), (values) =>
    documentOf(structure.children, { ...reading, values }),
  )
}
