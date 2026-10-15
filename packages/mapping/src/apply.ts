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

// The item each enclosing loop is on, by its source part, and the counter values it writes.
type Scope = {
  items: ReadonlyMap<string, JsonContent>
  counters: ReadonlyMap<string, string>
}

type Context = {
  document: JsonContent
  links: OutboundMappingVersion['links']
  loops: ReadonlyMap<string, Loop>
  scope: Scope
  values: Values
}

const isBeneath = (path: string, part: string) => path === part || path.startsWith(`${part}.`)

// A path through a repeating part reads only inside a loop over that part.
function read(document: JsonContent, scope: Scope, path: string): JsonContent | undefined {
  const bound = [...scope.items.keys()]
    .filter((part) => isBeneath(path, part))
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

function sourceValue(document: JsonContent, scope: Scope, path: string): string | undefined {
  const scalar = scalarSchema.safeParse(read(document, scope, path))

  return scalar.success ? String(scalar.data) : undefined
}

function itemsOf(document: JsonContent, scope: Scope, sourcePart: string): JsonContent[] {
  const items = itemsSchema.safeParse(read(document, scope, arrayBasePath(sourcePart)))

  return items.success ? items.data : []
}

function valuesIn(
  document: JsonContent,
  links: OutboundMappingVersion['links'],
  scope: Scope,
): Values {
  const values = new Map(scope.counters)

  for (const { sourcePath, targetPath } of links) {
    const value = sourceValue(document, scope, sourcePath)

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

// A loop's items output fills a segment group, every other link an element.
function unknownTarget(
  { links, transformLinks }: OutboundMappingVersion,
  body: ReadonlyArray<EdifactStructureNode>,
): string | undefined {
  const elements = new Set(elementPaths(body))
  const groups = new Set(groupPaths(body))

  const targets = [
    ...links.map(({ targetPath }) => ({ path: targetPath, known: elements })),
    ...transformLinks.flatMap(({ from, to }) =>
      to.kind === 'target'
        ? [
            {
              path: to.path,
              known: from.kind === 'transform' && from.output === 'items' ? groups : elements,
            },
          ]
        : [],
    ),
  ]

  return targets.find(({ path, known }) => !known.has(path))?.path
}

const hasValueBeneath = (part: StructurePart, values: Values) =>
  [...values.keys()].some((path) => path.startsWith(`${part.path}/`))

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
      targetPart.startsWith(`${part.path}/`) &&
      itemsOf(context.document, context.scope, sourcePart).length > 0,
  )

// An empty optional segment group is left out rather than failing.
const isPresent = (part: StructurePart, context: Context) =>
  isRequiredOrFilled(part, context.values) || hasItemsBeneath(part, context)

function within(context: Context, loop: Loop, item: JsonContent, index: number): Context {
  const counter = String(loop.counterStart + index)

  const scope = {
    items: new Map(context.scope.items).set(loop.sourcePart, item),
    counters: new Map([
      ...context.scope.counters,
      ...loop.counterTargets.map((path) => [path, counter] as const),
    ]),
  }

  return { ...context, scope, values: valuesIn(context.document, context.links, scope) }
}

function loopSegments(
  group: EdifactSegmentGroup,
  loop: Loop,
  context: Context,
): Effect.Effect<Segment[], MappingError> {
  const items = itemsOf(context.document, context.scope, loop.sourcePart)

  // A required group without items fails as one without values does.
  if (items.length === 0) {
    const found = group.required ? firstMissingRequired(group.children, context.values) : undefined

    return found === undefined ? Effect.succeed([]) : Effect.fail(missing(found))
  }

  return Effect.map(
    Effect.forEach(items, (item, index) =>
      segmentsOf(group.children, within(context, loop, item, index)),
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

function loopsOf({ transforms, transformLinks }: OutboundMappingVersion): Map<string, Loop> {
  const loops = new Map<string, Loop>()

  for (const transform of transforms) {
    if (transform.kind !== 'loop') {
      continue
    }

    const sourcePart = transformLinks.find(
      ({ to }) =>
        to.kind === 'transform' && to.transformId === transform.id && to.input === 'items',
    )?.from

    if (sourcePart?.kind !== 'source') {
      continue
    }

    const targets = (output: string) =>
      transformLinks.flatMap(({ from, to }) =>
        from.kind === 'transform' &&
        from.transformId === transform.id &&
        from.output === output &&
        to.kind === 'target'
          ? [to.path]
          : [],
      )

    const loop = {
      sourcePart: sourcePart.path,
      targetParts: targets('items'),
      counterStart: transform.config.counterStart,
      counterTargets: targets('counter'),
    }

    for (const targetPart of loop.targetParts) {
      loops.set(targetPart, loop)
    }
  }

  return loops
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
  const unknown = unknownTarget(version, body)

  if (unknown !== undefined) {
    return Effect.fail(new MappingError({ code: 'unknownTarget', targetPath: unknown }))
  }

  const scope: Scope = { items: new Map(), counters: new Map() }
  const { links } = version

  const context: Context = {
    document,
    links,
    loops: loopsOf(version),
    scope,
    values: valuesIn(document, links, scope),
  }

  return Effect.map(segmentsOf(body, context), (segments) => ({
    header: segmentOf(header, new Map([[`${header.path}/0062`, messageReference]])),
    segments,
    trailer: { tag: 'UNT', elements: [[String(segments.length + 2)], [messageReference]] },
  }))
}
