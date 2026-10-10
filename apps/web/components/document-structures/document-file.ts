import {
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureOrigin,
  type DocumentStructureOriginKind,
  type EncodedFile,
  maxDocumentStructureNameLength,
  maxEncodedFileBytes,
} from '@edi-bridge/contracts'

export function encodeBase64(bytes: Uint8Array) {
  let binary = ''

  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }

  return btoa(binary)
}

export function decodeBase64(content: string) {
  return Uint8Array.from(atob(content), (character) => character.charCodeAt(0))
}

export type FileProblem = 'empty' | 'tooLarge'

export type FileError = FileProblem | 'fileRequired'

export function fileProblem(size: number): FileProblem | null {
  if (size === 0) {
    return 'empty'
  }

  return size > maxEncodedFileBytes ? 'tooLarge' : null
}

export type ChosenFile =
  { problem: FileProblem; encoded: null } | { problem: null; encoded: EncodedFile }

export async function encodeFile(file: File): Promise<ChosenFile> {
  const problem = fileProblem(file.size)

  if (problem) {
    return { problem, encoded: null }
  }

  const content = encodeBase64(new Uint8Array(await file.arrayBuffer()))

  return { problem: null, encoded: { fileName: file.name, content } }
}

export type FileMessage = {
  key: FileError | 'unreadable' | 'unreadableCsv'
  invalid: boolean
}

export function fileMessageOf(
  fileError: FileError | null,
  unreadable: boolean,
  csv: boolean,
): FileMessage | null {
  if (fileError) {
    return { key: fileError, invalid: true }
  }

  if (!unreadable) {
    return null
  }

  return csv ? { key: 'unreadableCsv', invalid: false } : { key: 'unreadable', invalid: true }
}

export function originKindOf(fileName: string): DocumentStructureOriginKind | null {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.csv')) {
    return 'csvDocument'
  }

  if (lower.endsWith('.schema.json')) {
    return 'jsonSchema'
  }

  return lower.endsWith('.json') ? 'jsonDocument' : null
}

export function toOrigin(
  kind: DocumentStructureOriginKind,
  file: EncodedFile,
  csv: CsvSettings = defaultCsvSettings,
): DocumentStructureOrigin {
  switch (kind) {
    case 'jsonDocument':
      return { kind, document: file }
    case 'csvDocument':
      return { kind, document: file, csv }
    case 'jsonSchema':
      return { kind, jsonSchema: file }
  }
}

export function nameFromFileName(fileName: string) {
  return fileName
    .replace(/(\.schema)?\.[^.]+$/i, '')
    .replaceAll(/[-_]+/g, ' ')
    .trim()
    .slice(0, maxDocumentStructureNameLength)
}
