import {
  type BlockingMissingCode,
  type Direction,
  type FailedRunReference,
  type LookupTableEntry,
  lookupTableEntrySchema,
  type LookupTableKind,
  type LookupTableSummary,
  type MissingCode,
} from '@edi-bridge/contracts'

export type EntryProblem = 'required' | 'tooLong' | 'duplicate'

export type EntryProblems = {
  sourceCode: EntryProblem | null
  targetCode: EntryProblem | null
}

export function hasValue(entries: ReadonlyArray<LookupTableEntry>, sourceCode: string) {
  return entries.some((entry) => entry.sourceCode === sourceCode)
}

export function problemsOf(
  entries: ReadonlyArray<LookupTableEntry>,
  draft: LookupTableEntry,
  index: number | null,
): EntryProblems | null {
  const { error } = lookupTableEntrySchema.safeParse(draft)
  const sourceCode = draft.sourceCode.trim()

  const taken = entries.some(
    (entry, position) => position !== index && entry.sourceCode === sourceCode,
  )

  function schemaProblem(field: keyof LookupTableEntry): EntryProblem | null {
    const issue = error?.issues.find(({ path }) => path[0] === field)

    if (!issue) {
      return null
    }

    return issue.code === 'too_big' ? 'tooLong' : 'required'
  }

  const problems = {
    sourceCode: schemaProblem('sourceCode') ?? (taken ? 'duplicate' : null),
    targetCode: schemaProblem('targetCode'),
  }

  return problems.sourceCode === null && problems.targetCode === null ? null : problems
}

export function trimmedEntry(entry: LookupTableEntry): LookupTableEntry {
  return lookupTableEntrySchema.parse(entry)
}

export function withEntry(
  entries: ReadonlyArray<LookupTableEntry>,
  entry: LookupTableEntry,
  index: number | null,
): LookupTableEntry[] {
  return index === null
    ? [...entries, entry]
    : entries.map((current, position) => (position === index ? entry : current))
}

export function withoutEntry(entries: ReadonlyArray<LookupTableEntry>, index: number) {
  return entries.filter((_, position) => position !== index)
}

export function restoredEntry(
  entries: ReadonlyArray<LookupTableEntry>,
  entry: LookupTableEntry,
  index: number,
): LookupTableEntry[] {
  return entries.toSpliced(Math.min(index, entries.length), 0, entry)
}

export function matchesFilter(entry: LookupTableEntry, term: string) {
  return (
    term === '' ||
    entry.sourceCode.toLocaleLowerCase().includes(term) ||
    entry.targetCode.toLocaleLowerCase().includes(term)
  )
}

export const kindDirections = {
  units: 'outbound',
  countries: 'outbound',
  addresses: 'inbound',
  other: 'outbound',
} as const satisfies Record<LookupTableKind, Direction>

export function tableDirection({
  kind,
  uses,
}: Pick<LookupTableSummary, 'kind' | 'uses'>): Direction {
  if (uses.length === 0) {
    return kindDirections[kind]
  }

  return uses.some(({ direction }) => direction === 'inbound') ? 'inbound' : 'outbound'
}

export function newestFirst(runs: ReadonlyArray<FailedRunReference>) {
  return runs.toSorted((left, right) => right.receivedAt.localeCompare(left.receivedAt))
}

export type Fix = { code: string; targetCode: string; failedRuns: FailedRunReference[] }

function isBlocking(code: MissingCode): code is BlockingMissingCode {
  return code.urgency === 'blocking'
}

export function fixesOf(
  missingBefore: ReadonlyArray<MissingCode>,
  saved: ReadonlyArray<LookupTableEntry>,
): Fix[] {
  const targets = new Map(saved.map(({ sourceCode, targetCode }) => [sourceCode, targetCode]))

  return missingBefore.filter(isBlocking).flatMap(({ code, failedRuns }) => {
    const targetCode = targets.get(code)

    return targetCode === undefined ? [] : [{ code, targetCode, failedRuns }]
  })
}

export function withFixes(current: ReadonlyArray<Fix>, fixes: ReadonlyArray<Fix>): Fix[] {
  const codes = new Set(fixes.map(({ code }) => code))

  return [...current.filter(({ code }) => !codes.has(code)), ...fixes]
}

export function runsToReprocess(fixes: ReadonlyArray<Fix>, originRunId: string | undefined) {
  const runs = new Map(fixes.flatMap(({ failedRuns }) => failedRuns.map((run) => [run.id, run])))

  return newestFirst([...runs.values()]).toSorted(
    (left, right) => Number(right.id === originRunId) - Number(left.id === originRunId),
  )
}
