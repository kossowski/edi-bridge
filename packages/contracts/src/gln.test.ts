import { describe, expect, it } from 'vitest'

import { glnIssue, glnSchema, withCheckDigit } from './gln'

describe('withCheckDigit', () => {
  it.each([
    ['400638133393', '4006381333931'],
    ['021234500000', '0212345000007'],
    ['402000000000', '4020000000004'],
  ])('appends the GS1 check digit to %s', (digits, expected) => {
    expect(withCheckDigit(digits)).toBe(expected)
  })
})

describe('glnIssue', () => {
  it('accepts a GLN with a valid check digit', () => {
    expect(glnIssue('4006381333931')).toBeNull()
  })

  it.each(['400638133393', '40063813339310', '400638133393a', ' 4006381333931', ''])(
    'reports %j as a format issue',
    (value) => {
      expect(glnIssue(value)).toBe('format')
    },
  )

  it('reports a wrong last digit as a check digit issue', () => {
    expect(glnIssue('4006381333932')).toBe('checkDigit')
  })
})

describe('glnSchema', () => {
  it('names the issue in the error message', () => {
    const result = glnSchema.safeParse('4006381333932')

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('checkDigit')
  })
})
