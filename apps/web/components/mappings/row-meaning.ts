import type { CodeMeaning, TreeItemKind } from '@/components/mappings/mapping-tree'

export type KindMeaning = {
  tooltip: boolean
  required: 'mandatory' | 'required'
  optional: 'conditional' | 'optional'
  detail: 'format' | 'dataType'
  repetition: boolean
}

const edifact = {
  tooltip: true,
  required: 'mandatory',
  optional: 'conditional',
  detail: 'format',
  repetition: true,
} as const satisfies KindMeaning

// Document Structure parts carry no meaning beyond their row, so they get no tooltip.
const documentStructure = {
  tooltip: false,
  required: 'required',
  optional: 'optional',
  detail: 'dataType',
  repetition: true,
} as const satisfies KindMeaning

export const kindMeanings: Readonly<Record<TreeItemKind, KindMeaning>> = {
  field: documentStructure,
  object: documentStructure,
  array: documentStructure,
  segmentGroup: edifact,
  segment: edifact,
  // Composites and elements repeat only with their segment, so their own repetition says nothing.
  composite: { ...edifact, repetition: false },
  element: { ...edifact, repetition: false },
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
