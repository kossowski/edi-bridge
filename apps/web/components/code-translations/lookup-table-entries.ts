import { type LookupTableEntry, lookupTableEntrySchema } from '@edi-bridge/contracts'

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
