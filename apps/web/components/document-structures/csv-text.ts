import type { CharacterEncoding, CsvSettings, EncodedFile } from '@edi-bridge/contracts'

export const firstRowsByteCount = 48_000

export const firstRowCount = 5

export type FirstRows = {
  columns: string[]
  rows: string[][]
}

export function decodeFirstBytes(file: EncodedFile, encoding: CharacterEncoding) {
  const content = file.content.slice(0, Math.ceil(firstRowsByteCount / 3) * 4)
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0))

  return new TextDecoder(encoding).decode(bytes)
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

export function firstRows(text: string, { delimiter, headerRow }: CsvSettings): FirstRows {
  const split = splitRows(text, delimiter, firstRowCount + (headerRow ? 1 : 0))
  const [header = [], ...rest] = split
  const rows = headerRow ? rest : split
  const columnCount = Math.max(0, ...split.map((cells) => cells.length))

  const columns = Array.from({ length: columnCount }, (_, index) =>
    headerRow && header[index]?.trim() ? header[index].trim() : `column${index + 1}`,
  )

  return { columns, rows }
}

export function sameCsvSettings(a: CsvSettings, b: CsvSettings) {
  return a.delimiter === b.delimiter && a.headerRow === b.headerRow && a.encoding === b.encoding
}
