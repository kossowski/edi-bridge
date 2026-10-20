import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { maxDocumentBytes } from '@edi-bridge/contracts'

import { documentProblem, namesItsCharacterSet, parseMessageType } from './manual-submission'

const require = createRequire(import.meta.url)

const fixtureBytes = (path: string) =>
  new Uint8Array(readFileSync(require.resolve(`@edi-bridge/fixtures/documents/${path}`)))

describe('documentProblem', () => {
  it('asks for a file when none is chosen', () => {
    expect(documentProblem(null)).toBe('required')
  })

  it('rejects an empty file', () => {
    expect(documentProblem(new Uint8Array())).toBe('empty')
  })

  it('accepts a file up to the contract limit and rejects a larger one', () => {
    expect(documentProblem(new Uint8Array(maxDocumentBytes))).toBeNull()
    expect(documentProblem(new Uint8Array(maxDocumentBytes + 1))).toBe('tooLarge')
  })

  it('counts the bytes of a file, not its characters', () => {
    const umlauts = new TextEncoder().encode('ä'.repeat(maxDocumentBytes / 2 + 1))

    expect(documentProblem(umlauts)).toBe('tooLarge')
  })
})

describe('namesItsCharacterSet', () => {
  it('recognises an Interchange whose UNB names its character set', () => {
    expect(namesItsCharacterSet(fixtureBytes('valid/orders-nordlicht-markt.edi'))).toBe(true)
  })

  it('leaves a CSV Document to the chosen encoding', () => {
    expect(namesItsCharacterSet(fixtureBytes('valid/dispatch-nordlicht-markt.csv'))).toBe(false)
  })
})

describe('parseMessageType', () => {
  it('recognises a Message Type of the contract', () => {
    expect(parseMessageType('DESADV')).toBe('DESADV')
  })

  it('leaves a raw type outside the contract unnamed', () => {
    expect(parseMessageType('PRICAT')).toBeNull()
  })
})
