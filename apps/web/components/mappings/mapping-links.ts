import type { Graph } from '@/components/mappings/mapping-graph'
import type { CanvasLink, Side, TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingLink, TransformLink } from '@edi-bridge/contracts'

export type RowRef = { side: Side; path: string }

function collect(
  items: ReadonlyArray<TreeItem>,
  keep: (item: TreeItem) => boolean,
  into: TreeItem[] = [],
) {
  for (const item of items) {
    if (keep(item)) {
      into.push(item)
    }

    collect(item.children ?? [], keep, into)
  }

  return into
}

const isLeaf = (item: TreeItem) => item.children === null

const repeats = (item: TreeItem) => item.repeat !== null

export function leafPaths(items: ReadonlyArray<TreeItem>) {
  return new Set(collect(items, isLeaf).map(({ path }) => path))
}

export function repeatingPaths(items: ReadonlyArray<TreeItem>) {
  return new Set(collect(items, repeats).map(({ path }) => path))
}

export function pathsBeneath(items: ReadonlyArray<TreeItem>, part: string) {
  const [found] = collect(items, ({ path }) => path === part)

  return leafPaths(found?.children ?? [])
}

// A JSONata expression reads fields and also whole repeating parts, e.g. `$sum(lines.netPrice)`;
// in tree order, each part comes before its fields.
export function expressionPathItems(items: ReadonlyArray<TreeItem>) {
  return collect(items, (item) => isLeaf(item) || repeats(item))
}

export type PathsBySide = Readonly<Record<Side, ReadonlySet<string>>>

// Fields and elements take single values; repeating parts are linked whole, but only through a
// loop's items ports, which take nothing else.
export type LinkableRows = { leaves: PathsBySide; parts: PathsBySide }

export function isLinkableRow(rows: LinkableRows, { side, path }: RowRef) {
  return rows.leaves[side].has(path) || rows.parts[side].has(path)
}

export function isWholePart(rows: LinkableRows, { side, path }: RowRef) {
  return rows.parts[side].has(path) && !rows.leaves[side].has(path)
}

export type RowLink =
  { kind: 'link'; link: MappingLink } | { kind: 'transformLink'; link: TransformLink }

// A loop links whole parts, so a part's own path counts as well as its leaves.
function pathsOf(item: TreeItem) {
  return new Set([item.path, ...leafPaths(item.children ?? [])])
}

// A collapsed part carries the links of every leaf inside it, also those to and from transforms.
export function linksOfItem(graph: Graph, side: Side, item: TreeItem): RowLink[] {
  const paths = pathsOf(item)
  const key = side === 'source' ? 'sourcePath' : 'targetPath'

  const plain = graph.links.flatMap((link): RowLink[] =>
    paths.has(link[key]) ? [{ kind: 'link', link }] : [],
  )

  const throughTransforms = graph.transformLinks.flatMap((link): RowLink[] => {
    const end = side === 'source' ? link.from : link.to

    return end.kind !== 'transform' && paths.has(end.path) ? [{ kind: 'transformLink', link }] : []
  })

  return [...plain, ...throughTransforms]
}

// A merged edge lists its links at the part that was collapsed into it: the source part when
// several sources were merged, otherwise the target part.
export function rowListingLinks({ sourcePath, targetPath, links }: Omit<CanvasLink, 'id'>): RowRef {
  return links.some((link) => link.sourcePath !== sourcePath)
    ? { side: 'source', path: sourcePath }
    : { side: 'target', path: targetPath }
}
