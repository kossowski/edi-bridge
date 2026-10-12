import { type LookupTableEntry, maxLookupCodeLength } from '@edi-bridge/contracts'

export type EntryProblem = 'required' | 'tooLong' | 'duplicate'

export type EntryProblems = {
  sourceCode: EntryProblem | null
  targetCode: EntryProblem | null
}

function codeProblem(code: string): EntryProblem | null {
  const length = code.trim().length

  if (length === 0) {
    return 'required'
  }

  return length > maxLookupCodeLength ? 'tooLong' : null
}

export function hasValue(entries: ReadonlyArray<LookupTableEntry>, sourceCode: string) {
  return entries.some((entry) => entry.sourceCode === sourceCode)
}

export function problemsOf(
  entries: ReadonlyArray<LookupTableEntry>,
  draft: LookupTableEntry,
  index: number | null,
): EntryProblems | null {
  const sourceCode = draft.sourceCode.trim()

  const taken = entries.some(
    (entry, position) => position !== index && entry.sourceCode === sourceCode,
  )

  const problems = {
    sourceCode: codeProblem(sourceCode) ?? (taken ? 'duplicate' : null),
    targetCode: codeProblem(draft.targetCode),
  }

  return problems.sourceCode === null && problems.targetCode === null ? null : problems
}

export function trimmedEntry({ sourceCode, targetCode }: LookupTableEntry): LookupTableEntry {
  return { sourceCode: sourceCode.trim(), targetCode: targetCode.trim() }
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
