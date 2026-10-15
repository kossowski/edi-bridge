import { Data, Effect } from 'effect'

import {
  arrayBasePath,
  type DocumentStructure,
  DocumentStructureProblemError,
  type InferredDocumentStructure,
  type JsonContent,
  parseCsv,
  rootListPath,
} from '@edi-bridge/contracts'

import { jsonListSchema, jsonObjectSchema } from './json'

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
