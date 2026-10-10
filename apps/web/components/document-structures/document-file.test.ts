import { describe, expect, it } from 'vitest'

import { defaultCsvSettings, maxDocumentStructureNameLength } from '@edi-bridge/contracts'

import {
  decodeBase64,
  encodeBase64,
  encodeFile,
  fileMessageOf,
  fileProblem,
  nameFromFileName,
  originKindOf,
  toOrigin,
} from './document-file'

describe('document files', () => {
  it('encodes bytes as base64', () => {
    expect(encodeBase64(new TextEncoder().encode('Kühlware'))).toBe(
      Buffer.from('Kühlware').toString('base64'),
    )
  })

  it('decodes base64 to bytes', () => {
    expect(
      new TextDecoder().decode(decodeBase64(encodeBase64(new TextEncoder().encode('Kühlware')))),
    ).toBe('Kühlware')
  })

  it('encodes a chosen file or names its problem', async () => {
    await expect(encodeFile(new File(['a;b'], 'a.csv'))).resolves.toEqual({
      problem: null,
      encoded: { fileName: 'a.csv', content: btoa('a;b') },
    })
    await expect(encodeFile(new File([], 'empty.csv'))).resolves.toEqual({
      problem: 'empty',
      encoded: null,
    })
  })

  it('marks the file invalid only when the settings cannot fix it', () => {
    expect(fileMessageOf('tooLarge', true, true)).toEqual({ key: 'tooLarge', invalid: true })
    expect(fileMessageOf(null, true, true)).toEqual({ key: 'unreadableCsv', invalid: false })
    expect(fileMessageOf(null, true, false)).toEqual({ key: 'unreadable', invalid: true })
    expect(fileMessageOf(null, false, true)).toBeNull()
  })

  it('refuses empty and too large files', () => {
    expect(fileProblem(0)).toBe('empty')
    expect(fileProblem(5_000_001)).toBe('tooLarge')
    expect(fileProblem(12)).toBeNull()
  })

  it('guesses the origin from the file name', () => {
    expect(originKindOf('article.schema.json')).toBe('jsonSchema')
    expect(originKindOf('Order.JSON')).toBe('jsonDocument')
    expect(originKindOf('lieferscheine.csv')).toBe('csvDocument')
    expect(originKindOf('notes.txt')).toBeNull()
    expect(originKindOf('notes.pdf')).toBeNull()
  })

  it('reads a CSV Document with the default CSV settings', () => {
    const file = { fileName: 'a.csv', content: 'YQ==' }

    expect(toOrigin('csvDocument', file)).toEqual({
      kind: 'csvDocument',
      document: file,
      csv: defaultCsvSettings,
    })
    expect(toOrigin('jsonSchema', file)).toEqual({ kind: 'jsonSchema', jsonSchema: file })
  })

  it('reads a CSV Document with the chosen CSV settings', () => {
    const file = { fileName: 'a.csv', content: 'YQ==' }
    const csv = { delimiter: '\t', headerRow: false, encoding: 'windows-1252' } as const

    expect(toOrigin('csvDocument', file, csv)).toEqual({ kind: 'csvDocument', document: file, csv })
  })

  it('suggests a name from the file name', () => {
    expect(nameFromFileName('article.schema.json')).toBe('article')
    expect(nameFromFileName('erp_dispatch-export.csv')).toBe('erp dispatch export')
    expect(nameFromFileName(`${'a'.repeat(80)}.json`)).toHaveLength(maxDocumentStructureNameLength)
  })
})
