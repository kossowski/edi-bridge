import type { Side, TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingLink } from '@edi-bridge/contracts'

export type RowRef = { side: Side; path: string }

export type LinkChange = {
  kind: 'add' | 'remove'
  link: MappingLink
  links: MappingLink[]
}

export type AddedLink =
  | { ok: true; change: LinkChange }
  | { ok: false; reason: 'notLinkable' }
  | { ok: false; reason: 'alreadyLinked'; existing: MappingLink }

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

export function canLink(leaves: Leaves, from: RowRef, to: RowRef) {
  return (
    from.side === 'source' &&
    to.side === 'target' &&
    isLinkableRow(leaves, from) &&
    isLinkableRow(leaves, to)
  )
}

export function sameLink(a: MappingLink, b: MappingLink) {
  return a.sourcePath === b.sourcePath && a.targetPath === b.targetPath
}

// A target takes one value; combining several sources needs a transform, so a second link into
// a linked target is refused rather than replacing the first one.
export function addLink(
  links: ReadonlyArray<MappingLink>,
  leaves: Leaves,
  from: RowRef,
  to: RowRef,
): AddedLink {
  if (!canLink(leaves, from, to)) {
    return { ok: false, reason: 'notLinkable' }
  }

  const existing = links.find(({ targetPath }) => targetPath === to.path)

  if (existing) {
    return { ok: false, reason: 'alreadyLinked', existing }
  }

  const link = { sourcePath: from.path, targetPath: to.path }

  return { ok: true, change: { kind: 'add', link, links: [...links, link] } }
}

export function removeLink(links: ReadonlyArray<MappingLink>, link: MappingLink): LinkChange {
  return { kind: 'remove', link, links: links.filter((other) => !sameLink(other, link)) }
}

// A collapsed part carries the links of every leaf inside it.
export function linksOfItem(links: ReadonlyArray<MappingLink>, side: Side, item: TreeItem) {
  const paths = item.children === null ? new Set([item.path]) : leafPaths(item.children)
  const key = side === 'source' ? 'sourcePath' : 'targetPath'

  return links.filter((link) => paths.has(link[key]))
}
