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

export type FileProblem = 'empty' | 'tooLarge'

export function fileProblem(size: number): FileProblem | null {
  if (size === 0) {
    return 'empty'
  }

  return size > maxEncodedFileBytes ? 'tooLarge' : null
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
