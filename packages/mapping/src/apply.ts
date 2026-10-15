import { Effect } from 'effect'
import jsonata from 'jsonata'
import { z } from 'zod'

import {
  arrayBasePath,
  type ConditionOperator,
  type EdifactElement,
  type EdifactSegment,
  type EdifactSegmentGroup,
  type EdifactStructureNode,
  type JsonContent,
  type LinkStart,
  type LookupTableEntry,
  type MappingTransform,
  type MappingVersion,
  type MessageTypeStructure,
  messageTypeStructures,
  transformPorts,
} from '@edi-bridge/contracts'

import type { Element, Message, Segment } from '@edi-bridge/edifact'

import { childrenOf, elementPaths, type StructurePart } from './elements'
import { MappingError, type MappingErrorCode } from './errors'
import { reformatDate, reformatNumber } from './formats'
import { jsonListSchema, jsonObjectSchema } from './json'
import { isBeneath, isRequiredOrFilled, setFilled, type Values } from './values'
import {
  type Expressions,
  type Graph,
  type LookupTables,
  type Loop,
  type Wiring,
  wiringOf,
} from './wiring'

export type OutboundMappingVersion = Extract<MappingVersion, { direction: 'outbound' }>

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

type Scope = {
  items: ReadonlyMap<string, JsonContent>
  counters: ReadonlyMap<string, string>
}

type Context = {
  document: JsonContent
  links: OutboundMappingVersion['links']
  graph: Graph
  loops: ReadonlyMap<string, Loop>
  numbered: Map<Loop, number>
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

const valueSchema = z.union([z.string(), z.number(), z.boolean().transform(String)])

type Value = z.infer<typeof valueSchema>

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

type Evaluation = Reading & { targetPath: string; visiting: ReadonlySet<string> }

const failedTransform = (code: MappingErrorCode, { targetPath }: Evaluation, transformId: string) =>
  new MappingError({ code, targetPath, transformId })

function holds(operator: ConditionOperator, value: string, compareTo: string) {
  switch (operator) {
    case 'equals':
      return value === compareTo
    case 'notEquals':
      return value !== compareTo
    case 'contains':
      return value.includes(compareTo)
    case 'isEmpty':
      return value === ''
    case 'isNotEmpty':
      return value !== ''
  }
}

function lookedUp(
  { config: { lookupTableId, fallback } }: Extract<MappingTransform, { kind: 'lookupTable' }>,
  value: string,
  lookupTables: LookupTables,
  fail: (code: MappingErrorCode) => MappingError,
): Effect.Effect<string, MappingError> {
  const table = lookupTableId === null ? undefined : lookupTables.get(lookupTableId)

  if (table === undefined) {
    return Effect.fail(fail('unknownLookupTable'))
  }

  const found = table.get(value)

  if (value === '' || found !== undefined) {
    return Effect.succeed(found ?? '')
  }

  switch (fallback) {
    case 'keepValue':
      return Effect.succeed(value)
    case 'empty':
      return Effect.succeed('')
    case 'fail':
      return Effect.fail(fail('noLookupMatch'))
  }
}

function applied(
  transform: Exclude<MappingTransform, { kind: 'loop' | 'conditional' }>,
  args: Readonly<Record<string, Value>>,
  { expressions, lookupTables }: Graph,
  fail: (code: MappingErrorCode) => MappingError,
): Effect.Effect<string, MappingError> {
  const value = String(args.value ?? '')

  const formatted = (format: () => string | undefined, code: MappingErrorCode) => {
    const result = value === '' ? '' : format()

    return result === undefined ? Effect.fail(fail(code)) : Effect.succeed(result)
  }

  switch (transform.kind) {
    case 'constant':
      return Effect.succeed(transform.config.value)
    case 'concatenate':
      return Effect.succeed(
        transformPorts(transform)
          .inputs.map((input) => String(args[input] ?? ''))
          .filter((part) => part !== '')
          .join(transform.config.separator),
      )
    case 'split':
      return Effect.succeed(value.split(transform.config.separator)[transform.config.index] ?? '')
    case 'substring': {
      const { start, length } = transform.config

      return Effect.succeed(value.slice(start, length === null ? undefined : start + length))
    }

    case 'dateFormat':
      return formatted(
        () => reformatDate(value, transform.config.from, transform.config.to),
        'invalidDate',
      )
    case 'numberFormat':
      return formatted(
        () =>
          reformatNumber(
            args.value ?? '',
            transform.config.decimalPlaces,
            transform.config.decimalSeparator,
          ),
        'invalidNumber',
      )
    case 'lookupTable':
      return lookedUp(transform, value, lookupTables, fail)
    case 'jsonata': {
      const result = expressions.get(transform.id)

      return result === undefined ? Effect.fail(fail('expressionFailed')) : Effect.succeed(result)
    }
  }
}

function feedsOf(
  { feeding }: Pick<Graph, 'feeding'>,
  transform: MappingTransform,
): ReadonlyMap<string, LinkStart> {
  return new Map(
    transformPorts(transform).inputs.flatMap((input) => {
      const from = feeding.get(`${transform.id}/${input}`)

      return from ? [[input, from] as const] : []
    }),
  )
}

function outputOf(evaluation: Evaluation, start: LinkStart): Effect.Effect<Value, MappingError> {
  if (start.kind === 'source') {
    return Effect.succeed(scalarOf(evaluation, start.path) ?? '')
  }

  const { graph, scope, visiting } = evaluation
  const transform = graph.transforms.get(start.transformId)

  if (!transform || !graph.valid.has(transform.id) || visiting.has(transform.id)) {
    return Effect.fail(failedTransform('invalidTransform', evaluation, start.transformId))
  }

  if (transform.kind === 'loop') {
    return Effect.succeed(scope.counters.get(transform.id) ?? '')
  }

  const inner = { ...evaluation, visiting: new Set(visiting).add(transform.id) }

  const feeds = feedsOf(graph, transform)

  const inputOf = (input: string): Effect.Effect<Value, MappingError> => {
    const from = feeds.get(input)

    return from ? outputOf(inner, from) : Effect.succeed('')
  }

  if (transform.kind === 'conditional') {
    const { operator, compareTo } = transform.config

    return Effect.flatMap(inputOf('value'), (value) =>
      inputOf(holds(operator, String(value), compareTo) ? 'then' : 'else'),
    )
  }

  return Effect.flatMap(
    Effect.forEach(feeds, ([input, from]) =>
      Effect.map(outputOf(inner, from), (value): readonly [string, Value] => [input, value]),
    ),
    (args) =>
      applied(transform, Object.fromEntries(args), graph, (code) =>
        failedTransform(code, evaluation, transform.id),
      ),
  )
}

function valuesIn(context: Reading): Effect.Effect<Values, MappingError> {
  const values = new Map<string, string>()

  for (const { sourcePath, targetPath } of context.links) {
    setFilled(values, targetPath, sourceValue(context, sourcePath))
  }

  return Effect.as(
    Effect.forEach(context.graph.targets, ({ path, from }) =>
      Effect.map(outputOf({ ...context, targetPath: path, visiting: new Set() }, from), (value) =>
        setFilled(values, path, String(value)),
      ),
    ),
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

function sourcePathsOf(
  graph: Pick<Graph, 'transforms' | 'feeding'>,
  start: LinkStart,
  visited = new Set<string>(),
): string[] {
  if (start.kind === 'source') {
    return [start.path]
  }

  const transform = graph.transforms.get(start.transformId)

  if (!transform || transform.kind === 'loop' || visited.has(transform.id)) {
    return []
  }

  visited.add(transform.id)

  return [...feedsOf(graph, transform).values()].flatMap((from) =>
    sourcePathsOf(graph, from, visited),
  )
}

function outsideLoop(
  links: OutboundMappingVersion['links'],
  { graph, loops }: Wiring,
): string | undefined {
  const reads = [
    ...links,
    ...graph.targets.flatMap(({ path, from }) =>
      sourcePathsOf(graph, from).map((sourcePath) => ({ sourcePath, targetPath: path })),
    ),
  ]

  return reads.find(({ sourcePath, targetPath }) =>
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
  const numbered = context.numbered.get(loop) ?? 0

  context.numbered.set(loop, numbered + 1)

  const scope = {
    items: new Map(context.scope.items).set(loop.sourcePart, item),
    counters: new Map(context.scope.counters).set(loop.id, String(loop.counterStart + numbered)),
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

const resultSchema = scalarSchema.optional()

async function resultOf(expression: string, document: JsonContent): Promise<string | undefined> {
  try {
    const result = resultSchema.safeParse(await jsonata(expression).evaluate(document))

    return result.success ? String(result.data ?? '') : undefined
  } catch {
    return undefined
  }
}

// JSONata reads the whole Document, so each expression runs once, before the scopes of the loops.
function expressionsOf(
  transforms: ReadonlyArray<MappingTransform>,
  document: JsonContent,
): Effect.Effect<Expressions> {
  return Effect.map(
    Effect.forEach(transforms, (transform) =>
      transform.kind === 'jsonata'
        ? Effect.map(
            Effect.promise(() => resultOf(transform.config.expression, document)),
            (result) => (result === undefined ? [] : [[transform.id, result] as const]),
          )
        : Effect.succeed([]),
    ),
    (results) => new Map(results.flat()),
  )
}

const messageReference = '1'

export type ApplyOptions = {
  lookupTables?: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>
}

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

  return Effect.flatMap(expressionsOf(version.transforms, document), (expressions) => {
    const reading: Reading = {
      document,
      links: version.links,
      graph: { ...graph, expressions },
      loops,
      numbered: new Map(),
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
