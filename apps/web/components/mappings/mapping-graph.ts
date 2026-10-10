import {
  type LinkEnd,
  type LookupTableSummary,
  type LinkStart,
  type MappingGraph,
  type MappingLink,
  type MappingTransform,
  type TransformIssue,
  transformIssues,
  type TransformKind,
  type TransformLink,
  transformPorts,
} from '@edi-bridge/contracts'

import type { Side, TreeItem } from '@/components/mappings/mapping-tree'

import { isWholePart, type LinkableRows, pathsBeneath } from './mapping-links'
import { defaultConfig } from './transform-kinds'

export type Graph = Pick<MappingGraph, 'links' | 'transforms' | 'transformLinks'>

export type Position = MappingTransform['position']

type TransformUpdate = {
  before: MappingTransform
  after: MappingTransform
  dropped: TransformLink[]
}

export type GraphChange =
  | { kind: 'addLink' | 'removeLink'; link: MappingLink }
  | { kind: 'addTransformLink' | 'removeTransformLink'; link: TransformLink }
  | { kind: 'addTransform'; transform: MappingTransform }
  | { kind: 'removeTransform'; transform: MappingTransform; transformLinks: TransformLink[] }
  | ({ kind: 'configureTransform' } & TransformUpdate)
  | ({ kind: 'moveTransform' } & TransformUpdate)

export type Connected =
  | { ok: true; change: GraphChange }
  | { ok: false; reason: 'notLinkable' | 'needsPart' | 'needsLoop'; end: 'from' | 'to' }
  | { ok: false; reason: 'circle' }
  | { ok: false; reason: 'alreadyLinked' | 'inputTaken'; existing: LinkStart }

export function transformById(graph: Pick<Graph, 'transforms'>, transformId: string) {
  return graph.transforms.find(({ id }) => id === transformId)
}

export function startOfLink(link: MappingLink): LinkStart {
  return { kind: 'source', path: link.sourcePath }
}

export function sameStart(a: LinkStart | null, b: LinkStart) {
  if (a === null || a.kind !== b.kind) {
    return false
  }

  return a.kind === 'source'
    ? b.kind === 'source' && a.path === b.path
    : b.kind === 'transform' && a.transformId === b.transformId && a.output === b.output
}

export function sameEnd(a: LinkEnd, b: LinkEnd) {
  if (a.kind === 'target') {
    return b.kind === 'target' && a.path === b.path
  }

  return b.kind === 'transform' && a.transformId === b.transformId && a.input === b.input
}

export function sameTransformLink(a: TransformLink, b: TransformLink) {
  return sameStart(a.from, b.from) && sameEnd(a.to, b.to)
}

function samePlainLink(a: MappingLink, b: MappingLink) {
  return a.sourcePath === b.sourcePath && a.targetPath === b.targetPath
}

export function touchesTransform({ from, to }: TransformLink, transformId: string) {
  return (
    (from.kind === 'transform' && from.transformId === transformId) ||
    (to.kind === 'transform' && to.transformId === transformId)
  )
}

// A target takes one value, whether a plain link or a transform fills it.
export function linkIntoTarget(graph: Graph, path: string): LinkStart | null {
  const plain = graph.links.find((link) => link.targetPath === path)

  if (plain) {
    return startOfLink(plain)
  }

  return (
    graph.transformLinks.find(({ to }) => to.kind === 'target' && to.path === path)?.from ?? null
  )
}

export function linkIntoInput(graph: Graph, transformId: string, input: string) {
  return (
    graph.transformLinks.find(
      ({ to }) => to.kind === 'transform' && to.transformId === transformId && to.input === input,
    ) ?? null
  )
}

function portExists(graph: Graph, end: LinkStart | LinkEnd) {
  if (end.kind !== 'transform') {
    return true
  }

  const transform = transformById(graph, end.transformId)

  if (!transform) {
    return false
  }

  const { inputs, outputs } = transformPorts(transform)

  return 'input' in end ? inputs.includes(end.input) : outputs.includes(end.output)
}

const partPort = 'items'

export function takesPart(graph: Graph, end: LinkStart | LinkEnd) {
  const port = end.kind === 'transform' ? ('input' in end ? end.input : end.output) : null

  return (
    port === partPort &&
    end.kind === 'transform' &&
    transformById(graph, end.transformId)?.kind === 'loop'
  )
}

// Only a loop has an items output, so a link pending from one looks for a repeating target part,
// as one from a repeating source part looks for a loop's items input.
export function startsAtPart(rows: LinkableRows, from: LinkStart | null) {
  if (from?.kind === 'source') {
    return isWholePart(rows, { side: 'source', path: from.path })
  }

  return from?.kind === 'transform' && from.output === partPort
}

function rowRefused(rows: LinkableRows, side: 'source' | 'target', path: string) {
  return rows.parts[side].has(path) ? 'needsLoop' : 'notLinkable'
}

function endTaken(graph: Graph, to: LinkEnd) {
  return to.kind === 'target'
    ? linkIntoTarget(graph, to.path)
    : (linkIntoInput(graph, to.transformId, to.input)?.from ?? null)
}

function feeds(graph: Graph, from: string, to: string): boolean {
  const seen = new Set<string>()
  const queue = [from]

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (id === to) {
      return true
    }

    if (seen.has(id)) {
      continue
    }

    seen.add(id)

    for (const link of graph.transformLinks) {
      if (
        link.from.kind === 'transform' &&
        link.from.transformId === id &&
        link.to.kind === 'transform'
      ) {
        queue.push(link.to.transformId)
      }
    }
  }

  return false
}

function refusedEnds(
  graph: Graph,
  rows: LinkableRows,
  from: LinkStart,
  to: LinkEnd,
): Exclude<Connected, { ok: true }> | null {
  if (takesPart(graph, to)) {
    return from.kind === 'source' && rows.parts.source.has(from.path)
      ? null
      : { ok: false, reason: 'needsPart', end: 'to' }
  }

  if (takesPart(graph, from)) {
    return to.kind === 'target' && rows.parts.target.has(to.path)
      ? null
      : { ok: false, reason: 'needsPart', end: 'from' }
  }

  if (to.kind === 'target' ? !rows.leaves.target.has(to.path) : !portExists(graph, to)) {
    return {
      ok: false,
      reason: to.kind === 'target' ? rowRefused(rows, 'target', to.path) : 'notLinkable',
      end: 'to',
    }
  }

  if (from.kind === 'source' ? !rows.leaves.source.has(from.path) : !portExists(graph, from)) {
    return {
      ok: false,
      reason: from.kind === 'source' ? rowRefused(rows, 'source', from.path) : 'notLinkable',
      end: 'from',
    }
  }

  return null
}

export function connect(graph: Graph, rows: LinkableRows, from: LinkStart, to: LinkEnd): Connected {
  const refused = refusedEnds(graph, rows, from, to)

  if (refused) {
    return refused
  }

  const existing = endTaken(graph, to)

  if (existing) {
    return {
      ok: false,
      reason: to.kind === 'target' ? 'alreadyLinked' : 'inputTaken',
      existing,
    }
  }

  if (to.kind === 'target' && from.kind === 'source') {
    return {
      ok: true,
      change: { kind: 'addLink', link: { sourcePath: from.path, targetPath: to.path } },
    }
  }

  if (
    to.kind === 'transform' &&
    from.kind === 'transform' &&
    feeds(graph, to.transformId, from.transformId)
  ) {
    return { ok: false, reason: 'circle' }
  }

  return { ok: true, change: { kind: 'addTransformLink', link: { from, to } } }
}

function replaceTransform(
  transforms: ReadonlyArray<MappingTransform>,
  next: MappingTransform,
): MappingTransform[] {
  return transforms.map((transform) => (transform.id === next.id ? next : transform))
}

function withoutTransformLinks(
  transformLinks: ReadonlyArray<TransformLink>,
  removed: ReadonlyArray<TransformLink>,
) {
  return transformLinks.filter((link) => !removed.some((other) => sameTransformLink(link, other)))
}

export function applyChange(graph: Graph, change: GraphChange): Graph {
  switch (change.kind) {
    case 'addLink':
      return { ...graph, links: [...graph.links, change.link] }
    case 'removeLink':
      return { ...graph, links: graph.links.filter((link) => !samePlainLink(link, change.link)) }
    case 'addTransformLink':
      return { ...graph, transformLinks: [...graph.transformLinks, change.link] }
    case 'removeTransformLink':
      return {
        ...graph,
        transformLinks: withoutTransformLinks(graph.transformLinks, [change.link]),
      }
    case 'addTransform':
      return { ...graph, transforms: [...graph.transforms, change.transform] }
    case 'removeTransform':
      return {
        ...graph,
        transforms: graph.transforms.filter(({ id }) => id !== change.transform.id),
        transformLinks: graph.transformLinks.filter(
          (link) => !touchesTransform(link, change.transform.id),
        ),
      }
    case 'configureTransform':
    case 'moveTransform':
      return {
        ...graph,
        transforms: replaceTransform(graph.transforms, change.after),
        transformLinks: withoutTransformLinks(graph.transformLinks, change.dropped),
      }
  }
}

// Changes made after a failed one may have taken a target or an input, or removed a transform;
// what the failed change took away comes back only where it still fits.
function restorable(graph: Graph, { from, to }: TransformLink) {
  return portExists(graph, from) && portExists(graph, to) && endTaken(graph, to) === null
}

function restoreTransformLinks(graph: Graph, links: ReadonlyArray<TransformLink>): Graph {
  const transformLinks = [...graph.transformLinks]

  for (const link of links) {
    if (restorable({ ...graph, transformLinks }, link)) {
      transformLinks.push(link)
    }
  }

  return { ...graph, transformLinks }
}

// Later changes are already in the cache when a save fails, so it takes back only its own change.
export function revertChange(graph: Graph, change: GraphChange): Graph {
  switch (change.kind) {
    case 'addLink':
      return applyChange(graph, { kind: 'removeLink', link: change.link })
    case 'removeLink':
      return graph.links.some((link) => samePlainLink(link, change.link)) ||
        linkIntoTarget(graph, change.link.targetPath) !== null
        ? graph
        : { ...graph, links: [...graph.links, change.link] }
    case 'addTransformLink':
      return applyChange(graph, { kind: 'removeTransformLink', link: change.link })
    case 'removeTransformLink':
      return restoreTransformLinks(graph, [change.link])
    case 'addTransform':
      return applyChange(graph, {
        kind: 'removeTransform',
        transform: change.transform,
        transformLinks: [],
      })
    case 'removeTransform':
      return transformById(graph, change.transform.id)
        ? graph
        : restoreTransformLinks(
            { ...graph, transforms: [...graph.transforms, change.transform] },
            change.transformLinks,
          )
    case 'configureTransform':
    case 'moveTransform': {
      const current = transformById(graph, change.before.id)

      if (!current) {
        return graph
      }

      // Only what this change touched goes back, so a later move survives a failed configuration.
      // SAFETY: before and current are the same transform, so the config fits its kind.
      const reverted = (
        change.kind === 'moveTransform'
          ? { ...current, position: change.before.position }
          : { ...current, config: change.before.config }
      ) as MappingTransform

      return restoreTransformLinks(
        { ...graph, transforms: replaceTransform(graph.transforms, reverted) },
        change.dropped,
      )
    }
  }
}

export function removeTransform(graph: Graph, transformId: string): GraphChange | null {
  const transform = transformById(graph, transformId)

  return transform
    ? {
        kind: 'removeTransform',
        transform,
        transformLinks: graph.transformLinks.filter((link) => touchesTransform(link, transformId)),
      }
    : null
}

export function configureTransform(
  graph: Graph,
  before: MappingTransform,
  config: MappingTransform['config'],
): GraphChange {
  // SAFETY: the config comes from the form of the same kind, parsed with that kind's schema.
  const after = { ...before, config } as MappingTransform
  const ports = transformPorts(after)
  const inputs = new Set(ports.inputs)
  const outputs = new Set(ports.outputs)

  const dropped = graph.transformLinks.filter(
    ({ from, to }) =>
      (to.kind === 'transform' && to.transformId === before.id && !inputs.has(to.input)) ||
      (from.kind === 'transform' && from.transformId === before.id && !outputs.has(from.output)),
  )

  return { kind: 'configureTransform', before, after, dropped }
}

export const transformWidth = 180

export const transformInset = 40

export const transformColumns = 2

export const transformSlotWidth = 240

const transformAreaWidth = (transformColumns - 1) * transformSlotWidth + transformWidth

// The space between the trees holds the transforms, so it fits two columns of them.
export const transformGap = transformAreaWidth + 2 * transformInset

export const maxTransformX = transformAreaWidth - transformWidth

export function clampPosition({ x, y }: Position): Position {
  return { x: Math.min(Math.max(0, Math.round(x)), maxTransformX), y: Math.max(0, Math.round(y)) }
}

export type MoveChange = Extract<GraphChange, { kind: 'moveTransform' }>

export function moveTransform(transform: MappingTransform, position: Position): MoveChange {
  return {
    kind: 'moveTransform',
    before: transform,
    after: { ...transform, position: clampPosition(position) },
    dropped: [],
  }
}

export type Rect = Position & { height: number }

const slotMargin = 16

const slotStep = 20

export function freeSlot(
  taken: ReadonlyArray<Rect>,
  from: number,
  height: number,
  limit = 20_000,
): Position {
  for (let y = Math.max(0, Math.round(from)); y < limit; y += slotStep) {
    for (let column = 0; column < transformColumns; column += 1) {
      const x = column * transformSlotWidth

      const clear = taken.every(
        (other) =>
          Math.abs(other.x - x) >= transformWidth + slotMargin ||
          y + height + slotMargin <= other.y ||
          other.y + other.height + slotMargin <= y,
      )

      if (clear) {
        return { x, y }
      }
    }
  }

  return { x: 0, y: limit }
}

export function newTransform(
  kind: TransformKind,
  id: string,
  position: Position,
): MappingTransform {
  // SAFETY: each kind gets the default config of its own kind.
  return { id, kind, position, config: defaultConfig(kind) } as MappingTransform
}

export type TransformName = { kind: TransformKind; number: number }

// Several transforms of a kind are told apart by their number, in the order they were placed.
export function transformNames(transforms: ReadonlyArray<MappingTransform>) {
  const counts = new Map<TransformKind, number>()

  return new Map(
    transforms.map(({ id, kind }): [string, TransformName] => {
      const number = (counts.get(kind) ?? 0) + 1

      counts.set(kind, number)

      return [id, { kind, number }]
    }),
  )
}

export type CanvasIssue =
  | TransformIssue
  | { field: string; code: 'unknownLookupTable' }
  | { code: 'outsideLoop'; source: string; target: string }

export type CanvasTrees = Readonly<Record<Side, ReadonlyArray<TreeItem>>>

type FieldLink = { source: string; target: string }

// Each target field with the source fields that reach it, directly or through transforms. A loop's
// outputs carry no source field of their own, so the tracing stops there.
function fieldLinks(graph: Graph): FieldLink[] {
  const sourcesOf = (from: LinkStart, seen: ReadonlySet<string>): string[] => {
    if (from.kind === 'source') {
      return [from.path]
    }

    const transform = transformById(graph, from.transformId)

    if (!transform || transform.kind === 'loop' || seen.has(transform.id)) {
      return []
    }

    const next = new Set([...seen, transform.id])

    return graph.transformLinks.flatMap(({ from: upstream, to }) =>
      to.kind === 'transform' && to.transformId === transform.id ? sourcesOf(upstream, next) : [],
    )
  }

  return [
    ...graph.links.map(({ sourcePath, targetPath }) => ({
      source: sourcePath,
      target: targetPath,
    })),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      to.kind === 'target'
        ? sourcesOf(from, new Set()).map((source) => ({ source, target: to.path }))
        : [],
    ),
  ]
}

function partsOf(graph: Graph, loopId: string, port: 'input' | 'output') {
  return graph.transformLinks.flatMap(({ from, to }) => {
    if (port === 'input') {
      return to.kind === 'transform' &&
        to.transformId === loopId &&
        to.input === partPort &&
        from.kind === 'source'
        ? [from.path]
        : []
    }

    return from.kind === 'transform' &&
      from.transformId === loopId &&
      from.output === partPort &&
      to.kind === 'target'
      ? [to.path]
      : []
  })
}

// Links between fields beneath a loop's parts run once per item; one with only a single end
// beneath them would mix a value per item with one for the whole Document.
function loopIssues(graph: Graph, trees: CanvasTrees, loopId: string): CanvasIssue[] {
  const [sourcePart] = partsOf(graph, loopId, 'input')
  const targetParts = partsOf(graph, loopId, 'output')

  if (sourcePart === undefined || targetParts.length === 0) {
    return []
  }

  const sources = pathsBeneath(trees.source, sourcePart)
  const targets = new Set(targetParts.flatMap((part) => [...pathsBeneath(trees.target, part)]))

  return fieldLinks(graph)
    .filter(({ source, target }) => sources.has(source) !== targets.has(target))
    .map((link) => ({ code: 'outsideLoop', ...link }))
}

// The contract cannot know which Lookup Tables exist; a chosen one missing from the loaded list
// was deleted meanwhile. Until the list loads, nothing is reported.
export function canvasIssues(
  graph: Graph,
  lookupTables: ReadonlyArray<Pick<LookupTableSummary, 'id'>> | undefined,
  trees: CanvasTrees,
): Record<string, CanvasIssue[]> {
  const issues: Record<string, CanvasIssue[]> = transformIssues(graph)
  const known = new Set(lookupTables?.map(({ id }) => id))

  for (const transform of graph.transforms) {
    if (
      lookupTables &&
      transform.kind === 'lookupTable' &&
      transform.config.lookupTableId !== null &&
      !known.has(transform.config.lookupTableId)
    ) {
      issues[transform.id] = [
        { field: 'lookupTableId', code: 'unknownLookupTable' },
        ...(issues[transform.id] ?? []),
      ]
    }
  }

  for (const loop of graph.transforms.filter(({ kind }) => kind === 'loop')) {
    issues[loop.id] = [...(issues[loop.id] ?? []), ...loopIssues(graph, trees, loop.id)]
  }

  return issues
}
