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
  UnencodableCharacterError,
} from '@edi-bridge/contracts'

import { jsonListSchema, jsonObjectSchema } from './json'

export const documentWriteErrorCodes = ['unencodableCharacter'] as const

export type DocumentWriteErrorCode = (typeof documentWriteErrorCodes)[number]

export class DocumentWriteError extends Data.TaggedError('DocumentWriteError')<{
  readonly code: DocumentWriteErrorCode
  readonly line: number
  readonly fieldPath: string | null
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

function rowFields(structure: ReadStructure) {
  const [rows] = structure.children

  return rows?.kind === 'array' && rows.items.kind === 'object' ? rows.items.children : []
}

function columnsOf(structure: ReadStructure, listPath: string): string[] {
  return rowFields(structure).map(({ path }) => path.slice(listPath.length + 1))
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

type WrittenText = {
  text: string
  // The path of the structure field whose cell holds the character at an index of the text.
  fieldPathAt: (index: number) => string | null
}

function writeCsv(
  structure: Extract<ReadStructure, { format: 'csv' }>,
  content: JsonContent,
): WrittenText {
  const { delimiter, headerRow } = structure.csv
  const fields = rowFields(structure)
  const items = jsonObjectSchema.parse(content)[arrayBasePath(rootListPath(structure))] ?? []

  // Names, not path segments: they key the cells the engine writes and keep the sample's header.
  const rows = [
    ...(headerRow ? [fields.map(({ name, path }) => ({ value: name, fieldPath: path }))] : []),
    ...jsonListSchema.parse(items).map((item) => {
      const cells = csvRowSchema.parse(item)

      return fields.map(({ name, path }) => ({ value: cells[name], fieldPath: path }))
    }),
  ]

  const cellEnds: Array<{ end: number; fieldPath: string }> = []
  let text = ''

  for (const row of rows) {
    row.forEach(({ value, fieldPath }, index) => {
      text += `${index === 0 ? '' : delimiter}${csvCell(value, delimiter)}`
      cellEnds.push({ end: text.length, fieldPath })
    })
    text += csvLineBreak
  }

  return {
    text,
    fieldPathAt: (index) => cellEnds.find(({ end }) => index < end)?.fieldPath ?? null,
  }
}

function encoded(
  { text, fieldPathAt }: WrittenText,
  encoding: CharacterEncoding,
): Effect.Effect<Uint8Array, DocumentWriteError> {
  try {
    return Effect.succeed(encodeText(text, encoding))
  } catch (error) {
    if (error instanceof UnencodableCharacterError) {
      const line = text.slice(0, error.index).split('\n').length

      return Effect.fail(
        new DocumentWriteError({
          code: 'unencodableCharacter',
          line,
          fieldPath: fieldPathAt(error.index),
        }),
      )
    }

    throw error
  }
}

export function writeDocument(
  structure: ReadStructure,
  content: JsonContent,
): Effect.Effect<Uint8Array, DocumentWriteError> {
  return structure.format === 'csv'
    ? encoded(writeCsv(structure, content), structure.csv.encoding)
    : encoded({ text: `${JSON.stringify(content, null, 2)}\n`, fieldPathAt: () => null }, 'utf-8')
}
