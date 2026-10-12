import {
  arrayPath,
  childPath,
  type CsvSettings,
  type DocumentStructure,
  type DocumentStructureSample,
  type JsonContent,
  jsonContentSchema,
  jsonItemsName,
} from '@edi-bridge/contracts'

import { splitRows } from './csv-text'

export type SampleSegment = { text: string; path: string | null }

const indentOf = (depth: number) => '  '.repeat(depth)

export function jsonSampleSegments(text: string): SampleSegment[] | null {
  let parsed: JsonContent

  try {
    parsed = jsonContentSchema.parse(JSON.parse(text))
  } catch {
    return null
  }

  const segments: SampleSegment[] = []

  const write = (written: string) => {
    const last = segments.at(-1)

    if (last?.path === null) {
      last.text += written
    } else {
      segments.push({ text: written, path: null })
    }
  }

  const visitAll = (
    entries: ReadonlyArray<readonly [key: string | null, value: JsonContent, path: string]>,
    [open, close]: readonly [string, string],
    depth: number,
  ) => {
    if (entries.length === 0) {
      write(open + close)

      return
    }

    write(`${open}\n`)
    entries.forEach(([key, value, path], index) => {
      write(indentOf(depth + 1) + (key === null ? '' : `${JSON.stringify(key)}: `))
      visit(value, path, depth + 1)
      write(index < entries.length - 1 ? ',\n' : '\n')
    })
    write(indentOf(depth) + close)
  }

  const visit = (value: JsonContent, path: string, depth: number) => {
    if (Array.isArray(value)) {
      const itemPath = arrayPath(path === '' ? jsonItemsName : path)

      visitAll(
        value.map((item) => [null, item, itemPath] as const),
        ['[', ']'],
        depth,
      )
    } else if (value instanceof Object) {
      visitAll(
        Object.entries(value).map(([key, child]) => [key, child, childPath(path, key)] as const),
        ['{', '}'],
        depth,
      )
    } else {
      segments.push({ text: JSON.stringify(value), path })
    }
  }

  visit(parsed, '', 0)

  return segments
}

export function csvSampleRows(
  text: string,
  csv: CsvSettings,
  columnPaths: ReadonlyArray<string>,
  limit: number,
) {
  const all = splitRows(text, csv.delimiter, Number.POSITIVE_INFINITY)
  const data = csv.headerRow ? all.slice(1) : all

  return {
    rowCount: data.length,
    rows: data.slice(0, limit).map((cells) =>
      cells.map((cell, index): SampleSegment => ({
        text: cell,
        path: columnPaths[index] ?? null,
      })),
    ),
  }
}

const sampleRowLimit = 50

type CsvColumn = { path: string; name: string }

function csvColumns(structure: DocumentStructure): CsvColumn[] {
  const [rows] = structure.children

  if (rows?.kind !== 'array' || rows.items.kind !== 'object') {
    return []
  }

  return rows.items.children.map(({ path, name }) => ({ path, name }))
}

export type SampleContent =
  | { kind: 'json'; segments: SampleSegment[] }
  | { kind: 'csv'; columns: CsvColumn[]; rows: SampleSegment[][]; rowCount: number }
  | { kind: 'text' }

export function sampleContent(
  structure: DocumentStructure,
  sample: DocumentStructureSample,
): SampleContent {
  if (structure.format === 'csv') {
    const columns = csvColumns(structure)

    const read = csvSampleRows(
      sample.text,
      structure.csv,
      columns.map(({ path }) => path),
      sampleRowLimit,
    )

    return { kind: 'csv', columns, ...read }
  }

  const segments = jsonSampleSegments(sample.text)

  return segments ? { kind: 'json', segments } : { kind: 'text' }
}

function valueSegments(content: SampleContent) {
  switch (content.kind) {
    case 'json':
      return content.segments
    case 'csv':
      return content.rows.flat()
    case 'text':
      return []
  }
}

export function firstValues(content: SampleContent) {
  const values = new Map<string, string>()

  for (const { path, text } of valueSegments(content)) {
    if (path !== null && text !== '' && !values.has(path)) {
      values.set(path, text)
    }
  }

  return values
}

export function pathWithin(path: string, selected: string) {
  return path === selected || path.startsWith(`${selected}.`) || path.startsWith(`${selected}[]`)
}
