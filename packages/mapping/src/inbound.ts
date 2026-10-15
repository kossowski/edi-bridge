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
import {
  type EvaluatedGraph,
  evaluated,
  type SourceRead,
  targetValues,
  transformReads,
} from './evaluation'
import { hasValueBeneath, isBeneath, isRequiredOrFilled, setFilled, type Values } from './values'
import { type Loop, type Wiring, wiringOf } from './wiring'

import type { ApplyOptions } from './options'

export type InboundMappingVersion = Extract<MappingVersion, { direction: 'inbound' }>

type JsonObject = Record<string, JsonContent>

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

type PlacedPart = { occurrences: Occurrences; nodes: ReadonlyArray<EdifactStructureNode> }

// Outside the scope of a loop, a plain link reads the first repetition of a segment or group.
function valueAt({ occurrences, nodes }: PlacedPart, path: string): string | undefined {
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

function repetitionsOf({ occurrences, nodes }: PlacedPart, path: string): Occurrences[] {
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

const stepOf = ({ path }: { path: string }) => path.split('/').at(-1)!

function withoutEmpty(
  entries: ReadonlyArray<readonly [string, JsonContent | undefined]>,
): JsonObject {
  return Object.fromEntries(
    entries.flatMap(([key, value]) => (value === undefined || value === '' ? [] : [[key, value]])),
  )
}

function segmentContent(node: EdifactSegment, segment: Segment): JsonObject {
  return withoutEmpty(
    node.children.map((child, index) => {
      const element = segment.elements[index] ?? []

      if (child.kind === 'element') {
        return [stepOf(child), element[0]]
      }

      const components = withoutEmpty(
        child.children.map((component, position) => [stepOf(component), element[position]]),
      )

      return [stepOf(child), Object.keys(components).length === 0 ? undefined : components]
    }),
  )
}

// JSONata reads the Message as the web canvas writes its paths: one step per structure node.
function messageContent({ occurrences, nodes }: PlacedPart): JsonObject {
  return withoutEmpty(
    nodes.map((node) => {
      const repetitions =
        node.kind === 'segment'
          ? (occurrences.segments.get(node.path) ?? []).map((segment) =>
              segmentContent(node, segment),
            )
          : (occurrences.groups.get(node.path) ?? []).map((repetition) =>
              messageContent({ occurrences: repetition, nodes: node.children }),
            )

      const [first] = repetitions

      return [stepOf(node), node.maxRepeat > 1 && first ? repetitions : first]
    }),
  )
}

function groupsOf(nodes: ReadonlyArray<EdifactStructureNode>): EdifactSegmentGroup[] {
  return nodes.flatMap((node) =>
    node.kind === 'segmentGroup' ? [node, ...groupsOf(node.children)] : [],
  )
}

type RepetitionScope = {
  repetitions: ReadonlyMap<string, Occurrences>
  counters: ReadonlyMap<string, string>
  loopTargets: ReadonlySet<string>
}

type Reading = {
  message: PlacedPart
  groups: ReadonlyMap<string, EdifactSegmentGroup>
  links: InboundMappingVersion['links']
  graph: EvaluatedGraph
  loops: ReadonlyMap<string, Loop>
  itemCounts: Map<Loop, number>
  scope: RepetitionScope
}

type Context = Reading & { values: Values }

const repetitionsIn = (reading: Reading, sourcePart: string) =>
  repetitionsOf(enclosingPart(reading, sourcePart), sourcePart)

function enclosingPart({ message, groups, scope }: Reading, path: string): PlacedPart {
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
  const read = (sourcePath: string) => valueAt(enclosingPart(reading, sourcePath), sourcePath)

  for (const { sourcePath, targetPath } of reading.links) {
    if (isInScope(reading, targetPath)) {
      setFilled(values, targetPath, read(sourcePath))
    }
  }

  return targetValues(
    { graph: reading.graph, counters: reading.scope.counters, read },
    values,
    (path) => isInScope(reading, path),
  )
}

function enterRepetition(
  context: Context,
  loop: Loop,
  targetPart: string,
  repetition: Occurrences,
): Effect.Effect<Context, MappingError> {
  const itemCount = context.itemCounts.get(loop) ?? 0

  context.itemCounts.set(loop, itemCount + 1)

  const scope = {
    repetitions: new Map(context.scope.repetitions).set(loop.sourcePart, repetition),
    counters: new Map(context.scope.counters).set(loop.id, String(loop.counterStart + itemCount)),
    loopTargets: new Set(context.scope.loopTargets).add(targetPart),
  }

  const reading = { ...context, scope }

  return Effect.map(valuesIn(reading), (values) => ({ ...reading, values }))
}

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

type MappedEntries = Effect.Effect<Array<[string, JsonContent]>, MappingError>

function fieldContent(
  field: DocumentField,
  values: Values,
): Effect.Effect<JsonContent | undefined, MappingError> {
  const value = values.get(field.path)

  if (value === undefined) {
    return field.required
      ? Effect.fail(new MappingError({ code: 'missingRequiredValue', targetPath: field.path }))
      : Effect.succeed(undefined)
  }

  return fieldValue(field, value)
}

const fieldEntry = (field: DocumentField, values: Values): MappedEntries =>
  Effect.map(fieldContent(field, values), (content) =>
    content === undefined ? [] : [[field.name, content]],
  )

function itemOf(
  content: DocumentField | DocumentObject,
  context: Context,
): Effect.Effect<JsonContent, MappingError> {
  return content.kind === 'field'
    ? Effect.map(fieldContent(content, context.values), (item) => item ?? null)
    : documentOf(content.children, context)
}

const hasItemsBeneath = (path: string, context: Context) =>
  [...context.loops].some(
    ([targetPart, { sourcePart }]) =>
      isBeneath(targetPart, path, '.') && repetitionsIn(context, sourcePart).length > 0,
  )

function arrayEntry(node: DocumentArray, context: Context): MappedEntries {
  const loop = context.loops.get(node.path)
  const repetitions = loop ? repetitionsIn(context, loop.sourcePart) : []

  if (loop && repetitions.length > 0) {
    return Effect.map(
      Effect.forEach(repetitions, (repetition) =>
        Effect.flatMap(enterRepetition(context, loop, node.path, repetition), (inner) =>
          itemOf(node.items, inner),
        ),
      ),
      (items) => [[node.name, items]],
    )
  }

  if (hasValueBeneath(node, context.values, '.') || hasItemsBeneath(node.path, context)) {
    return Effect.map(itemOf(node.items, context), (item) => [[node.name, [item]]])
  }

  // A required array is written empty, as JSON asks only for the key.
  return Effect.succeed(node.required ? [[node.name, []]] : [])
}

// Only an object that is required or holds a value needs its required fields.
function documentOf(
  nodes: ReadonlyArray<DocumentStructureNode>,
  context: Context,
): Effect.Effect<JsonObject, MappingError> {
  return Effect.map(
    Effect.forEach(nodes, (node): MappedEntries => {
      switch (node.kind) {
        case 'field':
          return fieldEntry(node, context.values)
        case 'object':
          return isRequiredOrFilled(node, context.values, '.') ||
            hasItemsBeneath(node.path, context)
            ? Effect.map(documentOf(node.children, context), (content) => [[node.name, content]])
            : Effect.succeed([])
        case 'array':
          return arrayEntry(node, context)
      }
    }),
    (entries) => Object.fromEntries(entries.flat()),
  )
}

const loopReads = (loops: ReadonlyMap<string, Loop>): SourceRead[] =>
  [...loops].map(([targetPath, { sourcePart }]) => ({ sourcePath: sourcePart, targetPath }))

function unknownRead(
  links: ReadonlyArray<SourceRead>,
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
    ...loopReads(loops).map((read) => ({ ...read, known: groups })),
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

// A read from a looped segment group outside that loop has no repetition to read from.
function outsideLoop(
  links: ReadonlyArray<SourceRead>,
  loops: ReadonlyMap<string, Loop>,
): string | undefined {
  const looped = [...loops]

  return [...links, ...loopReads(loops)].find(({ sourcePath, targetPath }) =>
    looped.some(
      ([, { sourcePart }]) =>
        sourcePart !== sourcePath &&
        isBeneath(sourcePath, sourcePart) &&
        !looped.some(
          ([targetPart, loop]) =>
            loop.sourcePart === sourcePart && isBeneath(targetPath, targetPart, '.'),
        ),
    ),
  )?.targetPath
}

export function applyInboundMappingVersion(
  version: InboundMappingVersion,
  structure: DocumentStructure,
  message: Message,
  options: ApplyOptions = {},
): Effect.Effect<JsonContent, MappingError> {
  const { children } = messageTypeStructures[version.source.messageType]

  const wiring = wiringOf(version, options.lookupTables)
  const { graph, loops } = wiring
  const groups = groupsOf(children)
  const reads = [...version.links, ...transformReads(graph)]
  const unknown = unknownRead(reads, wiring, children, structure)

  if (unknown) {
    return Effect.fail(unknown)
  }

  const outside = outsideLoop(reads, loops)

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

  const placed = { occurrences, nodes: children }

  return Effect.flatMap(evaluated(graph, messageContent(placed)), (evaluatedGraph) => {
    const reading: Reading = {
      message: placed,
      groups: new Map(groups.map((group) => [group.path, group])),
      links: version.links,
      graph: evaluatedGraph,
      loops,
      itemCounts: new Map(),
      scope: { repetitions: new Map(), counters: new Map(), loopTargets: new Set() },
    }

    return Effect.flatMap(valuesIn(reading), (values) =>
      documentOf(structure.children, { ...reading, values }),
    )
  })
}
