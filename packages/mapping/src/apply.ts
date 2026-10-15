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

const itemsSchema = z.array(jsonContentSchema)

const scalarSchema = z.union([z.string(), z.number(), z.boolean()])

type Loop = {
  sourcePart: string
  targetParts: string[]
  counterStart: number
  counterTargets: string[]
}

type Scope = {
  items: ReadonlyMap<string, JsonContent>
  counters: ReadonlyMap<string, string>
}

type Context = {
  document: JsonContent
  links: OutboundMappingVersion['links']
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

function valuesIn(context: Reading): Values {
  const values = new Map(context.scope.counters)

  for (const { sourcePath, targetPath } of context.links) {
    const value = sourceValue(context, sourcePath)

    if (value !== undefined && value !== '') {
      values.set(targetPath, value)
    }
  }

  return values
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

type TransformTarget = { path: string; group: boolean }

type LoopDraft = Omit<Loop, 'sourcePart'> & { sourcePart?: string }

function wiringOf({ transforms, transformLinks }: OutboundMappingVersion) {
  const drafts = new Map<string, LoopDraft>()

  for (const transform of transforms) {
    if (transform.kind === 'loop') {
      drafts.set(transform.id, {
        targetParts: [],
        counterStart: transform.config.counterStart,
        counterTargets: [],
      })
    }
  }

  const targets: TransformTarget[] = []

  for (const { from, to } of transformLinks) {
    if (to.kind === 'transform') {
      const draft = drafts.get(to.transformId)

      if (draft && to.input === 'items' && from.kind === 'source') {
        draft.sourcePart = from.path
      }

      continue
    }

    const output = from.kind === 'transform' ? from.output : undefined
    const draft = from.kind === 'transform' ? drafts.get(from.transformId) : undefined

    targets.push({ path: to.path, group: output === 'items' })

    if (output === 'items') {
      draft?.targetParts.push(to.path)
    }

    if (output === 'counter') {
      draft?.counterTargets.push(to.path)
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

  return { loops, targets }
}

function unknownTarget(
  links: OutboundMappingVersion['links'],
  targets: ReadonlyArray<TransformTarget>,
  body: ReadonlyArray<EdifactStructureNode>,
): string | undefined {
  const elements = new Set(elementPaths(body))
  const groups = new Set(groupPaths(body))

  return [...links.map(({ targetPath }) => ({ path: targetPath, group: false })), ...targets].find(
    ({ path, group }) => !(group ? groups : elements).has(path),
  )?.path
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

function within(context: Context, loop: Loop, item: JsonContent): Context {
  const numbered = context.numbered.get(loop) ?? 0
  const counter = String(loop.counterStart + numbered)

  context.numbered.set(loop, numbered + 1)

  const scope = {
    items: new Map(context.scope.items).set(loop.sourcePart, item),
    counters: new Map([
      ...context.scope.counters,
      ...loop.counterTargets.map((path) => [path, counter] as const),
    ]),
  }

  return { ...context, scope, values: valuesIn({ ...context, scope }) }
}

function loopSegments(
  group: EdifactSegmentGroup,
  loop: Loop,
  context: Context,
): Effect.Effect<Segment[], MappingError> {
  const items = itemsOf(context, loop.sourcePart)

  // A required group without items fails as one without values does.
  if (items.length === 0) {
    const found = group.required ? firstMissingRequired(group.children, context.values) : undefined

    return found === undefined ? Effect.succeed([]) : Effect.fail(missing(found))
  }

  return Effect.map(
    Effect.forEach(items, (item) => segmentsOf(group.children, within(context, loop, item))),
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
  const { loops, targets } = wiringOf(version)
  const unknown = unknownTarget(version.links, targets, body)

  if (unknown !== undefined) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown }))
  }

  const reading: Reading = {
    document,
    links: version.links,
    loops,
    numbered: new Map(),
    scope: { items: new Map(), counters: new Map() },
  }

  const context: Context = { ...reading, values: valuesIn(reading) }

  return Effect.map(segmentsOf(body, context), (segments) => ({
    header: segmentOf(header, new Map([[`${header.path}/0062`, messageReference]])),
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  }))
}
