import {
  arrayPath,
  childPath,
  type CsvSettings,
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
