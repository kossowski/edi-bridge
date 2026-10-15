import { Data, Effect } from 'effect'
import { z } from 'zod'

import {
  arrayBasePath,
  type CharacterEncoding,
  type DocumentStructure,
  DocumentStructureProblemError,
  encodeText,
  type InferredDocumentStructure,
  type JsonContent,
  parseCsv,
  rootListPath,
  windows1252Byte,
} from '@edi-bridge/contracts'

import { jsonListSchema, jsonObjectSchema } from './json'

export const documentWriteErrorCodes = ['unencodableCharacter'] as const

export type DocumentWriteErrorCode = (typeof documentWriteErrorCodes)[number]

export class DocumentWriteError extends Data.TaggedError('DocumentWriteError')<{
  readonly code: DocumentWriteErrorCode
  readonly line: number
}> {}

export const documentReadErrorCodes = ['invalidJson', 'invalidCsv', 'unexpectedRoot'] as const

export type DocumentReadErrorCode = (typeof documentReadErrorCodes)[number]

export class DocumentReadError extends Data.TaggedError('DocumentReadError')<{
  readonly code: DocumentReadErrorCode
  readonly line: number | null
}> {}

type ReadStructure = DocumentStructure | InferredDocumentStructure

const failed = (code: DocumentReadErrorCode, line: number | null = null) =>
  Effect.fail(new DocumentReadError({ code, line }))

function readJson(
  root: Extract<ReadStructure, { format: 'json' }>['root'],
  text: string,
): Effect.Effect<JsonContent, DocumentReadError> {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return failed('invalidJson')
  }

  const listPath = rootListPath({ format: 'json', root })

  if (listPath === undefined) {
    const object = jsonObjectSchema.safeParse(value)

    return object.success ? Effect.succeed(object.data) : failed('unexpectedRoot')
  }

  const list = jsonListSchema.safeParse(value)

  return list.success
    ? Effect.succeed({ [arrayBasePath(listPath)]: list.data })
    : failed('unexpectedRoot')
}

function columnsOf(structure: ReadStructure, listPath: string): string[] {
  const [rows] = structure.children

  if (rows?.kind !== 'array' || rows.items.kind !== 'object') {
    return []
  }

  return rows.items.children.map(({ path }) => path.slice(listPath.length + 1))
}

function readCsv(
  structure: Extract<ReadStructure, { format: 'csv' }>,
  text: string,
): Effect.Effect<JsonContent, DocumentReadError> {
  let rows: ReturnType<typeof parseCsv>

  try {
    rows = parseCsv(text, structure.csv.delimiter)
  } catch (error) {
    if (error instanceof DocumentStructureProblemError) {
      return failed('invalidCsv', error.problem.line)
    }

    throw error
  }

  const listPath = rootListPath(structure)
  const columns = columnsOf(structure, listPath)
  const dataRows = structure.csv.headerRow ? rows.slice(1) : rows
  const tooLong = dataRows.find(({ cells }) => cells.length > columns.length)

  if (tooLong) {
    return failed('invalidCsv', tooLong.line)
  }

  return Effect.succeed({
    [arrayBasePath(listPath)]: dataRows.map(({ cells }) =>
      Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ''])),
    ),
  })
}

export function readDocument(
  structure: ReadStructure,
  text: string,
): Effect.Effect<JsonContent, DocumentReadError> {
  return structure.format === 'csv' ? readCsv(structure, text) : readJson(structure.root, text)
}

const csvLineBreak = '\r\n'

const csvRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))

type CsvCell = z.infer<typeof csvRowSchema>[string] | undefined

function csvCell(value: CsvCell, delimiter: string): string {
  const text = String(value ?? '')

  return [delimiter, '"', '\n', '\r'].some((character) => text.includes(character))
    ? `"${text.replaceAll('"', '""')}"`
    : text
}

// A row holds its cells under the names that the mapping engine writes, so the header row shows them.
function writeCsv(
  structure: Extract<ReadStructure, { format: 'csv' }>,
  content: JsonContent,
): string {
  const { delimiter, headerRow } = structure.csv
  const [rows] = structure.children
  const fields = rows?.kind === 'array' && rows.items.kind === 'object' ? rows.items.children : []
  const columns = fields.map(({ name }) => name)
  const items = jsonObjectSchema.parse(content)[arrayBasePath(rootListPath(structure))] ?? []

  const line = (cells: ReadonlyArray<CsvCell>) =>
    `${cells.map((cell) => csvCell(cell, delimiter)).join(delimiter)}${csvLineBreak}`

  const lines = jsonListSchema.parse(items).map((item) => {
    const cells = csvRowSchema.parse(item)

    return line(columns.map((column) => cells[column]))
  })

  return [...(headerRow ? [line(columns)] : []), ...lines].join('')
}

function encoded(
  text: string,
  encoding: CharacterEncoding,
): Effect.Effect<Uint8Array, DocumentWriteError> {
  const characters = [...text]

  const unencodable =
    encoding === 'windows-1252'
      ? characters.findIndex((character) => windows1252Byte(character) === undefined)
      : -1

  if (unencodable === -1) {
    return Effect.succeed(encodeText(text, encoding))
  }

  const line = characters.slice(0, unencodable).filter((character) => character === '\n').length

  return Effect.fail(new DocumentWriteError({ code: 'unencodableCharacter', line: line + 1 }))
}

export function writeDocument(
  structure: ReadStructure,
  content: JsonContent,
): Effect.Effect<Uint8Array, DocumentWriteError> {
  return structure.format === 'csv'
    ? encoded(writeCsv(structure, content), structure.csv.encoding)
    : encoded(`${JSON.stringify(content, null, 2)}\n`, 'utf-8')
}
