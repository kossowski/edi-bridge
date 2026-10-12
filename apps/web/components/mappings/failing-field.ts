import type { RowRef } from '@/components/mappings/mapping-links'
import type { Side, TreeItem } from '@/components/mappings/mapping-tree'

export type FailingField = {
  row: RowRef
  item: TreeItem
  ancestors: ReadonlyArray<TreeItem>
}

const sides: ReadonlyArray<Side> = ['source', 'target']

// A failure may name one repetition, e.g. `lines[2].gtin`, where the tree has `lines[].gtin`.
export function repetitionFree(path: string) {
  return path.trim().replaceAll(/\[\d*\]/g, '[]')
}

function withoutRepetitionMarks(path: string) {
  return path.replaceAll('[]', '')
}

function findInTree(
  items: ReadonlyArray<TreeItem>,
  matches: (item: TreeItem) => boolean,
  ancestors: ReadonlyArray<TreeItem>,
): { item: TreeItem; ancestors: ReadonlyArray<TreeItem> } | null {
  for (const item of items) {
    if (matches(item)) {
      return { item, ancestors }
    }

    const found = item.children && findInTree(item.children, matches, [...ancestors, item])

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
    (item: TreeItem) => withoutRepetitionMarks(item.path) === withoutRepetitionMarks(wanted),
  ]

  for (const matches of matchers) {
    for (const side of sides) {
      const found = findInTree(trees[side], matches, [])

      if (found) {
        return { row: { side, path: found.item.path }, ...found }
      }
    }
  }

  return null
}

export function failingFieldName({ item, ancestors }: Pick<FailingField, 'item' | 'ancestors'>) {
  const trail = [...ancestors, item].map(({ label }) => label).join(' › ')

  return item.name ? `${trail} (${item.name})` : trail
}
