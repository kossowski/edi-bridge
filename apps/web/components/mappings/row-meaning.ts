import type { CodeMeaning, TreeItemKind } from '@/components/mappings/mapping-tree'

const edifactKinds: ReadonlySet<TreeItemKind> = new Set([
  'segmentGroup',
  'segment',
  'composite',
  'element',
])

export function isEdifactKind(kind: TreeItemKind) {
  return edifactKinds.has(kind)
}

export type EdifactFormat = {
  characters: 'a' | 'n' | 'an'
  variable: boolean
  length: number
}

export function parseFormat(format: string): EdifactFormat | null {
  const match = /^(an|a|n)(\.\.)?(\d+)$/.exec(format)

  if (!match) {
    return null
  }

  const [, characters, variable, length] = match

  return {
    // SAFETY: the pattern's first group only matches `an`, `a` or `n`.
    characters: characters as EdifactFormat['characters'],
    variable: variable !== undefined,
    length: Number(length),
  }
}

// Hiding a single code saves no space over showing it.
export function limitCodes(codes: ReadonlyArray<CodeMeaning>, limit: number) {
  if (codes.length <= limit + 1) {
    return { shown: codes, hidden: 0 }
  }

  return { shown: codes.slice(0, limit), hidden: codes.length - limit }
}
