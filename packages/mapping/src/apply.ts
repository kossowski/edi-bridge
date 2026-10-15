import { Data, Effect } from 'effect'
import { z } from 'zod'

import {
  arrayBasePath,
  type EdifactComposite,
  type EdifactElement,
  type EdifactSegment,
  type EdifactSegmentGroup,
  type EdifactStructureNode,
  type JsonContent,
  jsonContentSchema,
  type LinkStart,
  type MappingTransform,
  type MappingVersion,
  type MessageTypeStructure,
  messageTypeStructures,
  transformIssues,
  transformPorts,
} from '@edi-bridge/contracts'

import type { Element, Message, Segment } from '@edi-bridge/edifact'

import { reformatDate, reformatNumber } from './formats'

export type OutboundMappingVersion = Extract<MappingVersion, { direction: 'outbound' }>

export const mappingErrorCodes = [
  'missingRequiredValue',
  'outsideLoop',
  'unknownTarget',
  'invalidTransform',
  'invalidDate',
  'invalidNumber',
] as const

export type MappingErrorCode = (typeof mappingErrorCodes)[number]

export class MappingError extends Data.TaggedError('MappingError')<{
  readonly code: MappingErrorCode
  readonly targetPath: string
  readonly transformId?: string
}> {}

type Values = ReadonlyMap<string, string>

const objectSchema = z.record(z.string(), jsonContentSchema)

const itemsSchema = z.array(jsonContentSchema)

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

type Loop = {
  id: string
  sourcePart: string
  targetParts: string[]
  counterStart: number
}

type Scope = {
  items: ReadonlyMap<string, JsonContent>
  counters: ReadonlyMap<string, string>
}

type TransformTarget = { path: string; from: LinkStart & { kind: 'transform' } }

type Graph = {
  transforms: ReadonlyMap<string, MappingTransform>
  feeding: ReadonlyMap<string, LinkStart>
  valid: ReadonlySet<string>
  targets: ReadonlyArray<TransformTarget>
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

const isBeneath = (path: string, part: string, separator = '/') =>
  path === part || path.startsWith(`${part}${separator}`)

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
    const object = objectSchema.safeParse(value)

    value = object.success && !key.endsWith('[]') ? object.data[key] : undefined
  }

  return value
}

function sourceValue(context: Reading, path: string): string | undefined {
  const scalar = scalarSchema.safeParse(read(context, path))

  return scalar.success ? String(scalar.data) : undefined
}

function itemsOf(context: Reading, sourcePart: string): JsonContent[] {
  const items = itemsSchema.safeParse(read(context, arrayBasePath(sourcePart)))

  return items.success ? items.data : []
}

type Evaluation = Reading & { targetPath: string; visiting: ReadonlySet<string> }

const failedTransform = (code: MappingErrorCode, { targetPath }: Evaluation, transformId: string) =>
  new MappingError({ code, targetPath, transformId })

function applied(
  transform: MappingTransform,
  args: Readonly<Record<string, string>>,
  fail: (code: MappingErrorCode) => MappingError,
): Effect.Effect<string, MappingError> {
  const value = args.value ?? ''

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
          .inputs.flatMap((input) => (args[input] ? [args[input]] : []))
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
          reformatNumber(value, transform.config.decimalPlaces, transform.config.decimalSeparator),
        'invalidNumber',
      )
    default:
      return Effect.succeed(value)
  }
}

function outputOf(evaluation: Evaluation, start: LinkStart): Effect.Effect<string, MappingError> {
  if (start.kind === 'source') {
    return Effect.succeed(sourceValue(evaluation, start.path) ?? '')
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

  return Effect.flatMap(
    Effect.forEach(transformPorts(transform).inputs, (input) => {
      const from = graph.feeding.get(`${transform.id}/${input}`)

      return Effect.map(
        from ? outputOf(inner, from) : Effect.succeed(''),
        (value): readonly [string, string] => [input, value],
      )
    }),
    (args) =>
      applied(transform, Object.fromEntries(args), (code) =>
        failedTransform(code, evaluation, transform.id),
      ),
  )
}

function valuesIn(context: Reading): Effect.Effect<Values, MappingError> {
  const values = new Map<string, string>()

  const set = (targetPath: string, value: string | undefined) => {
    if (value !== undefined && value !== '') {
      values.set(targetPath, value)
    }
  }

  for (const { sourcePath, targetPath } of context.links) {
    set(targetPath, sourceValue(context, sourcePath))
  }

  return Effect.as(
    Effect.forEach(context.graph.targets, ({ path, from }) =>
      Effect.map(outputOf({ ...context, targetPath: path, visiting: new Set() }, from), (value) =>
        set(path, value),
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

type StructurePart =
  EdifactStructureNode | EdifactSegment['children'][number] | EdifactComposite['children'][number]

const childrenOf = (part: StructurePart): ReadonlyArray<StructurePart> =>
  part.kind === 'element' ? [] : part.children

function elementPaths(parts: ReadonlyArray<StructurePart>): string[] {
  return parts.flatMap((part) =>
    part.kind === 'element' ? [part.path] : elementPaths(childrenOf(part)),
  )
}

function groupPaths(nodes: ReadonlyArray<EdifactStructureNode>): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'segmentGroup' ? [node.path, ...groupPaths(node.children)] : [],
  )
}

type LoopDraft = Omit<Loop, 'sourcePart'> & { sourcePart?: string }

function wiringOf(version: OutboundMappingVersion) {
  const { transforms, transformLinks } = version
  const drafts = new Map<string, LoopDraft>()

  for (const transform of transforms) {
    if (transform.kind === 'loop') {
      drafts.set(transform.id, {
        id: transform.id,
        targetParts: [],
        counterStart: transform.config.counterStart,
      })
    }
  }

  const feeding = new Map<string, LinkStart>()
  const targets: TransformTarget[] = []
  const groupTargets: string[] = []

  for (const { from, to } of transformLinks) {
    if (to.kind === 'transform') {
      const draft = drafts.get(to.transformId)

      if (draft && to.input === 'items' && from.kind === 'source') {
        draft.sourcePart = from.path
      }

      feeding.set(`${to.transformId}/${to.input}`, from)
      continue
    }

    if (from.kind === 'transform' && from.output === 'items') {
      groupTargets.push(to.path)
      drafts.get(from.transformId)?.targetParts.push(to.path)
      continue
    }

    if (from.kind === 'transform') {
      targets.push({ path: to.path, from })
    }
  }

  const loops = new Map<string, Loop>()

  for (const { sourcePart, ...draft } of drafts.values()) {
    if (sourcePart !== undefined) {
      const loop = { sourcePart, ...draft }

      for (const targetPart of loop.targetParts) {
        loops.set(targetPart, loop)
      }
    }
  }

  const issues = transformIssues(version)

  const graph: Graph = {
    transforms: new Map(transforms.map((transform) => [transform.id, transform])),
    feeding,
    valid: new Set(transforms.flatMap(({ id }) => (issues[id]?.length ? [] : [id]))),
    targets,
  }

  return { graph, loops, groupTargets }
}

function unknownTarget(
  links: OutboundMappingVersion['links'],
  { graph, groupTargets }: ReturnType<typeof wiringOf>,
  body: ReadonlyArray<EdifactStructureNode>,
): string | undefined {
  const elements = new Set(elementPaths(body))
  const groups = new Set(groupPaths(body))

  return (
    groupTargets.find((path) => !groups.has(path)) ??
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

function sourcePathsOf(graph: Graph, start: LinkStart, visited = new Set<string>()): string[] {
  if (start.kind === 'source') {
    return [start.path]
  }

  const transform = graph.transforms.get(start.transformId)

  if (!transform || transform.kind === 'loop' || visited.has(transform.id)) {
    return []
  }

  visited.add(transform.id)

  return transformPorts(transform).inputs.flatMap((input) => {
    const from = graph.feeding.get(`${transform.id}/${input}`)

    return from ? sourcePathsOf(graph, from, visited) : []
  })
}

function outsideLoop(
  links: OutboundMappingVersion['links'],
  { graph, loops }: ReturnType<typeof wiringOf>,
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

const hasValueBeneath = (part: StructurePart, values: Values) =>
  [...values.keys()].some((path) => isBeneath(path, part.path))

const isRequiredOrFilled = (part: StructurePart, values: Values) =>
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

const messageReference = '1'

export function applyMappingVersion(
  version: OutboundMappingVersion,
  document: JsonContent,
): Effect.Effect<Message, MappingError> {
  const structure = messageTypeStructures[version.target.messageType]
  const { header, body } = framed(structure)
  const wiring = wiringOf(version)
  const { graph, loops } = wiring
  const unknown = unknownTarget(version.links, wiring, body)

  if (unknown !== undefined) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown }))
  }

  const outside = outsideLoop(version.links, wiring)

  if (outside !== undefined) {
    return Effect.fail(new MappingError({ code: 'outsideLoop', targetPath: outside }))
  }

  const reading: Reading = {
    document,
    links: version.links,
    graph,
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
}
