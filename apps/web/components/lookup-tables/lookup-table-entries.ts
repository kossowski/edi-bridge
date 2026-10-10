import {
  type LookupTableEntry,
  lookupTableEntriesSchema,
  maxLookupCodeLength,
} from '@edi-bridge/contracts'

import { type FormIssue, tooLongOr } from '../../lib/forms/field-errors'

export const entryFields = ['sourceCode', 'targetCode'] as const

export type EntryField = (typeof entryFields)[number]

export type EntryRow = LookupTableEntry & { key: number }

export type EntryError =
  { kind: 'required' } | { kind: 'tooLong'; max: number } | { kind: 'duplicate'; row: number }

export type RowErrors = Partial<Record<EntryField, EntryError>>

export type EntriesResult =
  { entries: LookupTableEntry[] } | { errors: ReadonlyMap<number, RowErrors> }

function errorOf(issue: FormIssue, firstRows: ReadonlyMap<string, number>, sourceCode: string) {
  if (issue.code === 'custom') {
    return { kind: 'duplicate', row: (firstRows.get(sourceCode.trim()) ?? 0) + 1 } as const
  }

  return tooLongOr(issue, 'required') === 'tooLong'
    ? ({ kind: 'tooLong', max: maxLookupCodeLength } as const)
    : ({ kind: 'required' } as const)
}

function firstRowsBySourceCode(rows: ReadonlyArray<LookupTableEntry>) {
  const firstRows = new Map<string, number>()

  rows.forEach(({ sourceCode }, index) => {
    if (!firstRows.has(sourceCode.trim())) {
      firstRows.set(sourceCode.trim(), index)
    }
  })

  return firstRows
}

export function validateEntries(rows: ReadonlyArray<LookupTableEntry>): EntriesResult {
  const parsed = lookupTableEntriesSchema.safeParse(
    rows.map(({ sourceCode, targetCode }) => ({ sourceCode, targetCode })),
  )

  if (parsed.success) {
    return { entries: parsed.data }
  }

  const firstRows = firstRowsBySourceCode(rows)
  const errors = new Map<number, RowErrors>()

  for (const issue of parsed.error.issues) {
    const index = Number(issue.path[0])
    const field = entryFields.find((candidate) => candidate === issue.path[1])

    if (!Number.isInteger(index) || field === undefined) {
      continue
    }

    const rowErrors = errors.get(index) ?? {}
    rowErrors[field] ??= errorOf(issue, firstRows, rows[index]?.sourceCode ?? '')
    errors.set(index, rowErrors)
  }

  return { errors }
}

export function toRows(entries: ReadonlyArray<LookupTableEntry>, firstKey = 0): EntryRow[] {
  return entries.map((entry, index) => ({ ...entry, key: firstKey + index }))
}

export function sameEntries(
  rows: ReadonlyArray<LookupTableEntry>,
  entries: ReadonlyArray<LookupTableEntry>,
) {
  return (
    rows.length === entries.length &&
    rows.every(
      (row, index) =>
        row.sourceCode === entries[index]?.sourceCode &&
        row.targetCode === entries[index]?.targetCode,
    )
  )
}

export function matchesFilter(row: LookupTableEntry, term: string) {
  return (
    term === '' ||
    row.sourceCode.toLocaleLowerCase().includes(term) ||
    row.targetCode.toLocaleLowerCase().includes(term)
  )
}
