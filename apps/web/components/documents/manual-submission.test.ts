import { describe, expect, it } from 'vitest'

import { maxDocumentBytes } from '@edi-bridge/contracts'

import { documentProblem, parseMessageType } from './manual-submission'

describe('documentProblem', () => {
  it('asks for a file when none is chosen', () => {
    expect(documentProblem(null)).toBe('required')
  })

  it('rejects an empty file', () => {
    expect(documentProblem('')).toBe('empty')
  })

  it('accepts a file up to the contract limit and rejects a longer one', () => {
    expect(documentProblem('x'.repeat(maxDocumentBytes))).toBeNull()
    expect(documentProblem('x'.repeat(maxDocumentBytes + 1))).toBe('tooLarge')
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
