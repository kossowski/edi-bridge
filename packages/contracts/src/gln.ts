import { z } from 'zod'

export function withCheckDigit(digits: string) {
  const sum = [...digits]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0)

  return `${digits}${(10 - (sum % 10)) % 10}`
}

export type GlnIssue = 'format' | 'checkDigit'

export function glnIssue(value: string): GlnIssue | null {
  if (!/^\d{13}$/.test(value)) {
    return 'format'
  }

  return withCheckDigit(value.slice(0, 12)) === value ? null : 'checkDigit'
}

export const glnSchema = z.string().superRefine((value, context) => {
  const issue = glnIssue(value)

  if (issue !== null) {
    context.addIssue({ code: 'custom', message: issue })
  }
})
