import type { RowRef } from '@/components/mappings/mapping-links'
import type { Side, TreeItem } from '@/components/mappings/mapping-tree'

export type FailingField = {
  row: RowRef
  item: TreeItem
  // From the top of the tree down to the field's parent, the parts that hold it.
  ancestors: ReadonlyArray<TreeItem>
}

const sides: ReadonlyArray<Side> = ['source', 'target']

// A failure may name one repetition, e.g. `lines[2].gtin`, where the tree has `lines[].gtin`.
export function repetitionFree(path: string) {
  return path.trim().replaceAll(/\[\d*\]/g, '[]')
}

function bare(path: string) {
  return path.replaceAll('[]', '')
}

function search(
  items: ReadonlyArray<TreeItem>,
  matches: (item: TreeItem) => boolean,
  ancestors: ReadonlyArray<TreeItem>,
): { item: TreeItem; ancestors: ReadonlyArray<TreeItem> } | null {
  for (const item of items) {
    if (matches(item)) {
      return { item, ancestors }
    }

    const found = item.children && search(item.children, matches, [...ancestors, item])

    if (found) {
      return found
    }
  }

  return null
}

// The path of a failure is a tree path on either side. An exact match wins; failing that, a path
// written without the repetition marks, e.g. `lines.gtin`, still finds `lines[].gtin`.
export function findFailingField(
  path: string,
  trees: Readonly<Record<Side, ReadonlyArray<TreeItem>>>,
): FailingField | null {
  const wanted = repetitionFree(path)

  if (wanted === '') {
    return null
  }

  const matchers = [
    (item: TreeItem) => item.path === wanted,
    (item: TreeItem) => bare(item.path) === bare(wanted),
  ]

  for (const matches of matchers) {
    for (const side of sides) {
      const found = search(trees[side], matches, [])

      if (found) {
        return { row: { side, path: found.item.path }, ...found }
      }
    }
  }

  return null
}

// Named by the parts down to it, e.g. `lines › gtin`, with an EDIFACT element's meaning after it.
export function failingFieldName({ item, ancestors }: Pick<FailingField, 'item' | 'ancestors'>) {
  const trail = [...ancestors, item].map(({ label }) => label).join(' › ')

  return item.name ? `${trail} (${item.name})` : trail
}
