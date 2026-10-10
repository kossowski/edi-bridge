import type { TreeItem } from '@/components/mappings/mapping-tree'
import type {
  DifferenceChange,
  MappingDifference,
  MappingSample,
  MappingVersionSummary,
} from '@edi-bridge/contracts'

export type ComparisonRequest = {
  from?: string | undefined
  to?: string | undefined
  sample?: string | undefined
}

export type ComparisonSelection =
  | { kind: 'tooFew' }
  | { kind: 'unknownVersion'; from: string | null; to: string | null }
  | { kind: 'sameVersion'; from: string; to: string }
  | { kind: 'ready'; from: MappingVersionSummary; to: MappingVersionSummary }

export function newestFirst<Version extends Pick<MappingVersionSummary, 'version'>>(
  versions: ReadonlyArray<Version>,
): Version[] {
  return [...versions].sort((a, b) => b.version - a.version)
}

export function resolveVersions(
  versions: ReadonlyArray<MappingVersionSummary>,
  { from, to }: ComparisonRequest,
): ComparisonSelection {
  const [latest, previous] = newestFirst(versions)

  if (!latest || !previous) {
    return { kind: 'tooFew' }
  }

  const find = (id: string | undefined, fallback: MappingVersionSummary) =>
    id === undefined ? fallback : versions.find((version) => version.id === id)

  const earlier = find(from, previous)
  const later = find(to, latest)

  if (!earlier || !later) {
    return { kind: 'unknownVersion', from: earlier?.id ?? null, to: later?.id ?? null }
  }

  if (earlier.id === later.id) {
    return { kind: 'sameVersion', from: earlier.id, to: later.id }
  }

  return { kind: 'ready', from: earlier, to: later }
}

export type SampleSelection =
  { kind: 'none' } | { kind: 'unknown' } | { kind: 'ready'; sample: MappingSample }

export function resolveSample(
  samples: ReadonlyArray<MappingSample>,
  requested: string | undefined,
): SampleSelection {
  if (requested === undefined) {
    const [first] = samples

    return first ? { kind: 'ready', sample: first } : { kind: 'none' }
  }

  const sample = samples.find(({ id }) => id === requested)

  return sample ? { kind: 'ready', sample } : { kind: 'unknown' }
}

const comparisonKeys = ['from', 'to', 'sample'] as const

// Other parameters stay, so a shared address keeps whatever else it carries.
export function comparisonSearch(current: string, request: ComparisonRequest) {
  const params = new URLSearchParams(current)

  for (const key of comparisonKeys) {
    const value = request[key]

    if (value === undefined) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  }

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

export function comparisonHref(mappingId: string, request: ComparisonRequest = {}) {
  return `/mappings/${mappingId}/versions/compare${comparisonSearch('', request)}`
}

export function trailOf(items: ReadonlyArray<TreeItem>, path: string): TreeItem[] {
  for (const item of items) {
    if (item.path === path) {
      return [item]
    }

    const below = trailOf(item.children ?? [], path)

    if (below.length > 0) {
      return [item, ...below]
    }
  }

  return []
}

export type Repetition = { label: string | null; number: number }

// A tree whose repeating parts do not match the indices cannot name them, but the numbers still help.
export function repetitionsOf(
  trail: ReadonlyArray<TreeItem>,
  indices: ReadonlyArray<number>,
): Repetition[] {
  const repeating = trail.filter(({ repeat }) => repeat !== null)
  const named = repeating.length === indices.length

  return indices.map((index, position) => ({
    label: named ? repeating[position]!.label : null,
    number: index + 1,
  }))
}

export type ChangeCounts = Record<DifferenceChange, number>

export function changeCounts(differences: ReadonlyArray<Pick<MappingDifference, 'change'>>) {
  const counts: ChangeCounts = { added: 0, removed: 0, changed: 0 }

  for (const { change } of differences) {
    counts[change] += 1
  }

  return counts
}

export const differenceKinds = ['link', 'transform', 'transformLink'] as const

export function byKind(differences: ReadonlyArray<MappingDifference>) {
  return differenceKinds.map((kind) => ({
    kind,
    differences: differences.filter((difference) => difference.kind === kind),
  }))
}

export function outputChange(before: string | null, after: string | null): DifferenceChange {
  if (before === null) {
    return 'added'
  }

  return after === null ? 'removed' : 'changed'
}
