import { describe, expect, it } from 'vitest'

import { defaultCsvSettings, maxDocumentStructureNameLength } from '@edi-bridge/contracts'

import {
  encodeBase64,
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

  it('suggests a name from the file name', () => {
    expect(nameFromFileName('article.schema.json')).toBe('article')
    expect(nameFromFileName('erp_dispatch-export.csv')).toBe('erp dispatch export')
    expect(nameFromFileName(`${'a'.repeat(80)}.json`)).toHaveLength(maxDocumentStructureNameLength)
  })
})
