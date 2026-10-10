import type { CharacterEncoding, CsvSettings, EncodedFile } from '@edi-bridge/contracts'

import { decodeBase64 } from './document-file'

import type { StructureTree } from './structure-tree'

const firstRowsByteCount = 48_000

export const firstRowCount = 5

export function decodeFirstBytes(file: EncodedFile, encoding: CharacterEncoding) {
  const content = file.content.slice(0, Math.ceil(firstRowsByteCount / 3) * 4)

  return new TextDecoder(encoding).decode(decodeBase64(content))
}

export function splitRows(text: string, delimiter: string, limit: number) {
  const rows: string[][] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false

  const endRow = () => {
    cells.push(cell)

    if (cells.length > 1 || cells[0] !== '') {
      rows.push(cells)
    }

    cells = []
    cell = ''
  }

  for (let index = 0; index < text.length && rows.length < limit; index++) {
    const character = text[index]!

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell === '') {
      quoted = true
    } else if (character === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index++
      }

      endRow()
    } else {
      cell += character
    }
  }

  if (rows.length < limit && (cell !== '' || cells.length > 0)) {
    endRow()
  }

  return rows
}

export function firstRows(
  text: string,
  { delimiter, headerRow }: CsvSettings,
  columns: ReadonlyArray<string> | null,
) {
  const skipHeader = headerRow && columns !== null
  const rows = splitRows(text, delimiter, firstRowCount + (headerRow ? 1 : 0))

  return skipHeader ? rows.slice(1) : rows
}

export function csvColumnNames(tree: StructureTree): string[] | null {
  const [rows] = tree.children

  if (tree.format !== 'csv' || rows?.kind !== 'array' || rows.items.kind !== 'object') {
    return null
  }

  return rows.items.children.map(({ name }) => name)
}

export function sameCsvSettings(a: CsvSettings, b: CsvSettings) {
  return a.delimiter === b.delimiter && a.headerRow === b.headerRow && a.encoding === b.encoding
}
