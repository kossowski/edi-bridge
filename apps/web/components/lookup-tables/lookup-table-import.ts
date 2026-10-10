import {
  type LookupTableImportRow,
  lookupTableImportRowSchema,
  type LookupTableImportStatus,
  maxLookupTableCsvLength,
} from '@edi-bridge/contracts'

export const importStatuses = lookupTableImportRowSchema.options.map(
  (variant) => variant.shape.status.value,
)

export type ImportCounts = Record<LookupTableImportStatus, number>

export type ImportFilter = LookupTableImportStatus | 'all'

export type CsvError = 'empty' | 'tooLarge'

export const previewPageSize = 200

export function countByStatus(rows: ReadonlyArray<LookupTableImportRow>): ImportCounts {
  const counts: ImportCounts = { added: 0, changed: 0, unchanged: 0, invalid: 0 }

  for (const { status } of rows) {
    counts[status]++
  }

  return counts
}

export function rowsWithStatus(rows: ReadonlyArray<LookupTableImportRow>, filter: ImportFilter) {
  return filter === 'all' ? rows : rows.filter(({ status }) => status === filter)
}

export function hasChanges(counts: ImportCounts) {
  return counts.added + counts.changed > 0
}

export function checkCsv(csv: string): CsvError | null {
  if (csv.trim() === '') {
    return 'empty'
  }

  return csv.length > maxLookupTableCsvLength ? 'tooLarge' : null
}
