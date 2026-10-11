import { describe, expect, it } from 'vitest'

import {
  budgetUsage,
  parseWholeNumber,
  toWorkspaceSettingsInput,
  wholeNumberError,
  workspaceSettingsErrors,
} from './workspace-settings'

describe('parseWholeNumber', () => {
  it('reads plain digits and English or German digit grouping', () => {
    expect(parseWholeNumber(' 90 ')).toBe(90)
    expect(parseWholeNumber('200,000')).toBe(200_000)
    expect(parseWholeNumber('10.000.000')).toBe(10_000_000)
    expect(parseWholeNumber('1 500 000')).toBe(1_500_000)
  })

  it('rejects decimals, signs and badly grouped digits', () => {
    expect(parseWholeNumber('1.5')).toBeNull()
    expect(parseWholeNumber('-3')).toBeNull()
    expect(parseWholeNumber('20,00')).toBeNull()
    expect(parseWholeNumber('abc')).toBeNull()
  })
})

describe('wholeNumberError', () => {
  const bounds = { min: 7, max: 730 }

  it('names what is wrong with the value', () => {
    expect(wholeNumberError('', bounds)).toBe('required')
    expect(wholeNumberError('7.5', bounds)).toBe('notWhole')
    expect(wholeNumberError('6', bounds)).toBe('outOfRange')
    expect(wholeNumberError('731', bounds)).toBe('outOfRange')
    expect(wholeNumberError('730', bounds)).toBeNull()
  })
})

describe('workspaceSettingsErrors', () => {
  it('checks both fields against the contract bounds', () => {
    expect(workspaceSettingsErrors({ documentRetentionDays: '90', dailyLimit: '0' })).toEqual({})
    expect(
      workspaceSettingsErrors({ documentRetentionDays: '3', dailyLimit: '10,000,001' }),
    ).toEqual({ documentRetentionDays: 'outOfRange', dailyLimit: 'outOfRange' })
  })
})

describe('toWorkspaceSettingsInput', () => {
  it('turns the form values into the request body', () => {
    expect(
      toWorkspaceSettingsInput({ documentRetentionDays: '30', dailyLimit: '250.000' }),
    ).toEqual({ documentRetentionDays: 30, aiTokenBudget: { dailyLimit: 250_000 } })
  })
})

describe('budgetUsage', () => {
  it('reports the share used and whether the budget is used up', () => {
    expect(budgetUsage({ dailyLimit: 200_000, usedToday: 50_000 })).toEqual({
      off: false,
      exhausted: false,
      share: 0.25,
    })
    expect(budgetUsage({ dailyLimit: 1000, usedToday: 1200 })).toEqual({
      off: false,
      exhausted: true,
      share: 1,
    })
    expect(budgetUsage({ dailyLimit: 0, usedToday: 0 })).toEqual({
      off: true,
      exhausted: true,
      share: 1,
    })
  })
})
