import { transformLinkTargets } from '@edi-bridge/contracts'

import type { AiMarks } from '@/components/mappings/ai-marks'
import type { Graph } from '@/components/mappings/mapping-graph'
import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingLink, PreviewNote, TransformLink } from '@edi-bridge/contracts'

// A Transform chain the AI took part in: the target it fills (none when the chain fills nothing),
// the Transforms on the way, the Transform that fills the target first, and the source fields.
export type ProposedChain = {
  targetPath: string | null
  transformIds: string[]
  sourcePaths: string[]
  lookupTable: boolean
}

function mappedPaths(graph: Graph) {
  return new Set([
    ...graph.links.map(({ targetPath }) => targetPath),
    ...transformLinkTargets(graph.transformLinks),
  ])
}

const serviceSegments = new Set(['UNH', 'UNS', 'UNT'])

// EDI Bridge writes these without a link: the service segments that frame every Message, an
// element with a single allowed code, and a date format next to a filled date.
function filledWithoutLink(item: TreeItem, siblings: ReadonlyArray<TreeItem>, mapped: Set<string>) {
  if (item.edifact?.codes.length === 1) {
    return true
  }

  return (
    item.label === '2379' &&
    siblings.some((sibling) => sibling.label === '2380' && mapped.has(sibling.path))
  )
}

// A part ends up in the target Document when something beneath it is mapped, or when it is
// required inside a part that ends up there; only then do its required fields have to be filled.
export function unmappedRequiredTargets(items: ReadonlyArray<TreeItem>, graph: Graph): TreeItem[] {
  const mapped = mappedPaths(graph)

  const mappedBeneath = (item: TreeItem): boolean =>
    mapped.has(item.path) || (item.children ?? []).some(mappedBeneath)

  const walk = (children: ReadonlyArray<TreeItem>, present: boolean): TreeItem[] =>
    children.flatMap((item) => {
      if (item.children === null) {
        return present &&
          item.required &&
          !mapped.has(item.path) &&
          !filledWithoutLink(item, children, mapped)
          ? [item]
          : []
      }

      if (item.kind === 'segment' && serviceSegments.has(item.label)) {
        return []
      }

      return walk(item.children, mappedBeneath(item) || (present && item.required))
    })

  return walk(items, true)
}

export function ancestorPaths(items: ReadonlyArray<TreeItem>, path: string): string[] {
  for (const item of items) {
    if (item.path === path) {
      return []
    }

    const below = ancestorPaths(item.children ?? [], path)

    if (below.length > 0 || (item.children ?? []).some((child) => child.path === path)) {
      return [item.path, ...below]
    }
  }

  return []
}

export function treeOrder(items: ReadonlyArray<TreeItem>) {
  const order = new Map<string, number>()

  const walk = (children: ReadonlyArray<TreeItem>) =>
    children.forEach((item) => {
      order.set(item.path, order.size)
      walk(item.children ?? [])
    })

  walk(items)

  return (path: string | null) => (path === null ? Infinity : (order.get(path) ?? order.size))
}

function chainOf(graph: Graph, marks: AiMarks, last: TransformLink) {
  const transformIds: string[] = []
  const sourcePaths: string[] = []
  let proposed = marks.transformLink(last)
  const pending = [last]

  for (let link = pending.shift(); link; link = pending.shift()) {
    const { from } = link

    if (from.kind === 'source') {
      if (!sourcePaths.includes(from.path)) {
        sourcePaths.push(from.path)
      }
    } else if (!transformIds.includes(from.transformId)) {
      transformIds.push(from.transformId)
      proposed ||= marks.transform(from.transformId)

      for (const into of graph.transformLinks) {
        if (into.to.kind === 'transform' && into.to.transformId === from.transformId) {
          proposed ||= marks.transformLink(into)
          pending.push(into)
        }
      }
    }
  }

  return { transformIds, sourcePaths, proposed }
}

// Each AI-proposed part that runs through Transforms belongs to the chain of the target it fills;
// a proposed Transform that fills no target still needs a look of its own.
export function proposedChains(graph: Graph, marks: AiMarks): ProposedChain[] {
  const lookupTables = new Set(
    graph.transforms.filter(({ kind }) => kind === 'lookupTable').map(({ id }) => id),
  )

  const reached = new Set<string>()

  const chains = graph.transformLinks.flatMap((link): ProposedChain[] => {
    if (link.to.kind !== 'target') {
      return []
    }

    const { transformIds, sourcePaths, proposed } = chainOf(graph, marks, link)

    transformIds.forEach((id) => reached.add(id))

    return proposed
      ? [
          {
            targetPath: link.to.path,
            transformIds,
            sourcePaths,
            lookupTable: transformIds.some((id) => lookupTables.has(id)),
          },
        ]
      : []
  })

  const unused = graph.transforms
    .filter(({ id }) => marks.transform(id) && !reached.has(id))
    .map(({ id }): ProposedChain => ({
      targetPath: null,
      transformIds: [id],
      sourcePaths: [],
      lookupTable: lookupTables.has(id),
    }))

  return [...chains, ...unused]
}

export function plainProposedLinks(graph: Graph, marks: AiMarks): MappingLink[] {
  return graph.links.filter((link) => marks.link(link))
}

export function byTarget<Part>(
  parts: ReadonlyArray<Part>,
  targetOf: (part: Part) => string | null,
  order: (path: string | null) => number,
) {
  return [...parts].sort((a, b) => order(targetOf(a)) - order(targetOf(b)))
}

export function reviewAttention({
  graph,
  marks,
  targetItems,
  notes,
}: {
  graph: Graph
  marks: AiMarks
  targetItems: ReadonlyArray<TreeItem>
  notes: ReadonlyArray<PreviewNote> | undefined
}) {
  const order = treeOrder(targetItems)

  return {
    unmapped: unmappedRequiredTargets(targetItems, graph),
    chains: byTarget(proposedChains(graph, marks), (chain) => chain.targetPath, order),
    warnings: notes && byTarget(notes, (note) => note.targetPath, order),
    plain: byTarget(plainProposedLinks(graph, marks), (link) => link.targetPath, order),
  }
}
