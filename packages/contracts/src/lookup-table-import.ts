import {
  type LookupTableEntry,
  type LookupTableImportReason,
  type LookupTableImportRow,
  maxLookupCodeLength,
} from './lookup-table'

const delimiters = [';', ',', '\t'] as const

const headerNames = {
  source: new Set(['source', 'sourcecode', 'quelle', 'quellcode']),
  target: new Set(['target', 'targetcode', 'ziel', 'zielcode']),
}

function cellsOf(line: string, delimiter: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]

    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"'
        index++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }

  return [...cells, cell.trim()]
}

function delimiterOf(line: string) {
  const counts = delimiters.map((delimiter) => cellsOf(line, delimiter).length)

  return delimiters[counts.indexOf(Math.max(...counts))]!
}

const normalized = (cell: string | undefined) => cell?.toLowerCase().replaceAll(/[^a-z]/g, '')

function isHeader([source, target, ...rest]: ReadonlyArray<string>) {
  return (
    rest.length === 0 &&
    headerNames.source.has(normalized(source) ?? '') &&
    headerNames.target.has(normalized(target) ?? '')
  )
}

function reasonsOf(cells: ReadonlyArray<string>): LookupTableImportReason[] {
  if (cells.length !== 2) {
    return ['columnCount']
  }

  const [source = '', target = ''] = cells

  return [
    ...(source === '' ? (['sourceCodeMissing'] as const) : []),
    ...(target === '' ? (['targetCodeMissing'] as const) : []),
    ...(source.length > maxLookupCodeLength ? (['sourceCodeTooLong'] as const) : []),
    ...(target.length > maxLookupCodeLength ? (['targetCodeTooLong'] as const) : []),
  ]
}

export function classifyLookupTableImport(
  entries: ReadonlyArray<LookupTableEntry>,
  csv: string,
): LookupTableImportRow[] {
  const existing = new Map(entries.map(({ sourceCode, targetCode }) => [sourceCode, targetCode]))

  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((text, index) => ({ text, line: index + 1 }))

  const filled = lines.filter(({ text }) => text.trim() !== '')
  const delimiter = delimiterOf(filled[0]?.text ?? '')
  const seen = new Set<string>()

  return filled.flatMap(({ text, line }, index): LookupTableImportRow[] => {
    const cells = cellsOf(text, delimiter)

    if (index === 0 && isHeader(cells)) {
      return []
    }

    const reasons = reasonsOf(cells)

    if (reasons.length > 0) {
      return [{ line, status: 'invalid', cells, reasons }]
    }

    const [sourceCode = '', targetCode = ''] = cells

    if (seen.has(sourceCode)) {
      return [{ line, status: 'invalid', cells, reasons: ['duplicateSourceCode'] }]
    }

    seen.add(sourceCode)
    const previousTargetCode = existing.get(sourceCode)

    if (previousTargetCode === undefined) {
      return [{ line, status: 'added', sourceCode, targetCode }]
    }

    return previousTargetCode === targetCode
      ? [{ line, status: 'unchanged', sourceCode, targetCode }]
      : [{ line, status: 'changed', sourceCode, targetCode, previousTargetCode }]
  })
}

export function applyLookupTableImport(
  entries: ReadonlyArray<LookupTableEntry>,
  rows: ReadonlyArray<LookupTableImportRow>,
): LookupTableEntry[] {
  const changed = new Map(
    rows.flatMap((row) =>
      row.status === 'changed' ? [[row.sourceCode, row.targetCode] as const] : [],
    ),
  )

  return [
    ...entries.map(({ sourceCode, targetCode }) => ({
      sourceCode,
      targetCode: changed.get(sourceCode) ?? targetCode,
    })),
    ...rows.flatMap((row) =>
      row.status === 'added' ? [{ sourceCode: row.sourceCode, targetCode: row.targetCode }] : [],
    ),
  ]
}
