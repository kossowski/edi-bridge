import type { Graph } from '@/components/mappings/mapping-graph'
import type { CanvasLink, Side, TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingLink, TransformLink } from '@edi-bridge/contracts'

export type RowRef = { side: Side; path: string }

export function leafPaths(items: ReadonlyArray<TreeItem>, into = new Set<string>()) {
  for (const item of items) {
    if (item.children === null) {
      into.add(item.path)
    } else {
      leafPaths(item.children, into)
    }
  }

  return into
}

export type Leaves = Readonly<Record<Side, ReadonlySet<string>>>

export function isLinkableRow(leaves: Leaves, row: RowRef) {
  return leaves[row.side].has(row.path)
}

export type RowLink =
  { kind: 'link'; link: MappingLink } | { kind: 'transformLink'; link: TransformLink }

// A loop links whole parts, so a part's own path counts as well as its leaves.
function pathsOf(item: TreeItem) {
  return leafPaths(item.children ?? [], new Set([item.path]))
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
