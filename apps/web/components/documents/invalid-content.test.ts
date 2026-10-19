import { describe, expect, it } from 'vitest'

import { validationErrorCodes } from '@edi-bridge/edifact'

import messagesDe from '../../messages/de.json'
import messagesEn from '../../messages/en.json'
import { invalidContentCode } from './invalid-content'

type Texts = Readonly<Record<string, string>>

describe('invalidContentCode', () => {
  it('keeps a validation problem code of the edifact package', () => {
    expect(invalidContentCode('too-long-element')).toBe('too-long-element')
  })

  it('turns any other code into other', () => {
    expect(invalidContentCode('invalidDate')).toBe('other')
  })

  it.each([
    ['en', messagesEn],
    ['de', messagesDe],
  ])('has a title and a problem text for each validation problem code in %s', (_, messages) => {
    const texts = messages.Document.problem.reason.invalidContent
    const titles: Texts = texts.title
    const problems: Texts = texts.problem
    const codes = [...validationErrorCodes, 'other']

    expect(Object.keys(titles).toSorted()).toEqual(codes.toSorted())
    expect(Object.keys(problems).toSorted()).toEqual(codes.toSorted())
  })
})
