import { describe, expect, it } from 'vitest'

import { maxDocumentLength } from '@edi-bridge/contracts'

import { documentProblem, knownMessageType } from './upload-document'

describe('documentProblem', () => {
  it('asks for a file when none is chosen', () => {
    expect(documentProblem(null)).toBe('required')
  })

  it('rejects an empty file', () => {
    expect(documentProblem('')).toBe('empty')
  })

  it('accepts a file up to the contract limit and rejects a longer one', () => {
    expect(documentProblem('x'.repeat(maxDocumentLength))).toBeNull()
    expect(documentProblem('x'.repeat(maxDocumentLength + 1))).toBe('tooLarge')
  })
})

describe('knownMessageType', () => {
  it('recognises a Message Type of the contract', () => {
    expect(knownMessageType('DESADV')).toBe('DESADV')
  })

  it('leaves a raw type outside the contract unnamed', () => {
    expect(knownMessageType('PRICAT')).toBeNull()
  })
})
