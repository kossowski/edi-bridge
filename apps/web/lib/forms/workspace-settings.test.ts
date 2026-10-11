import { describe, expect, it } from 'vitest'

import { createWorkspaceSettings } from '@edi-bridge/mocks'

import {
  budgetUsage,
  groupSeparatorOf,
  parseWholeNumber,
  toWorkspaceSettingsValues,
  validateWorkspaceSettings,
} from './workspace-settings'

const english = groupSeparatorOf('en')

const german = groupSeparatorOf('de')

describe('groupSeparatorOf', () => {
  it('reads the digit group separator of the locale', () => {
    expect(english).toBe(',')
    expect(german).toBe('.')
  })
})

describe('parseWholeNumber', () => {
  it('reads plain digits, spaces and the grouping of the active locale', () => {
    expect(parseWholeNumber(' 90 ', english)).toBe(90)
    expect(parseWholeNumber('200,000', english)).toBe(200_000)
    expect(parseWholeNumber('10.000.000', german)).toBe(10_000_000)
    expect(parseWholeNumber('1 500 000', german)).toBe(1_500_000)
  })

  it('rejects the separator of another locale', () => {
    expect(parseWholeNumber('1.500', english)).toBeNull()
    expect(parseWholeNumber('1,500', german)).toBeNull()
  })

  it('rejects decimals, signs and badly grouped digits', () => {
    expect(parseWholeNumber('1.5', english)).toBeNull()
    expect(parseWholeNumber('1,5', german)).toBeNull()
    expect(parseWholeNumber('-3', english)).toBeNull()
    expect(parseWholeNumber('20,00', english)).toBeNull()
    expect(parseWholeNumber('abc', english)).toBeNull()
  })
})

describe('validateWorkspaceSettings', () => {
  it('turns valid values into the request body', () => {
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '30', dailyLimit: '250.000' }, german),
    ).toEqual({ input: { documentRetentionDays: 30, aiTokenBudget: { dailyLimit: 250_000 } } })
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '90', dailyLimit: '0' }, english),
    ).toEqual({ input: { documentRetentionDays: 90, aiTokenBudget: { dailyLimit: 0 } } })
  })

  it('names what is wrong with each field', () => {
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '', dailyLimit: '1.5' }, english),
    ).toEqual({ errors: { documentRetentionDays: 'required', dailyLimit: 'notWhole' } })
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '6', dailyLimit: '10,000,001' }, english),
    ).toEqual({ errors: { documentRetentionDays: 'outOfRange', dailyLimit: 'outOfRange' } })
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '731', dailyLimit: '200' }, english),
    ).toEqual({ errors: { documentRetentionDays: 'outOfRange' } })
  })

  it('accepts the contract bounds', () => {
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '7', dailyLimit: '10,000,000' }, english),
    ).toHaveProperty('input')
    expect(
      validateWorkspaceSettings({ documentRetentionDays: '730', dailyLimit: '0' }, english),
    ).toHaveProperty('input')
  })
})

describe('toWorkspaceSettingsValues', () => {
  it('formats the stored settings for the form', () => {
    const settings = createWorkspaceSettings({
      documentRetentionDays: 90,
      aiTokenBudget: { dailyLimit: 40_000, usedToday: 0 },
    })

    expect(toWorkspaceSettingsValues(settings, (value) => value.toLocaleString('en'))).toEqual({
      documentRetentionDays: '90',
      dailyLimit: '40,000',
    })
  })
})

describe('budgetUsage', () => {
  it('reports the share used, capped for the bar, and whether the budget is used up', () => {
    expect(budgetUsage({ dailyLimit: 200_000, usedToday: 50_000 })).toEqual({
      turnedOff: false,
      exhausted: false,
      share: 0.25,
      filled: 0.25,
    })
    expect(budgetUsage({ dailyLimit: 1000, usedToday: 1200 })).toEqual({
      turnedOff: false,
      exhausted: true,
      share: 1.2,
      filled: 1,
    })
  })

  it('reports a limit of 0 as turned off, not as used up', () => {
    expect(budgetUsage({ dailyLimit: 0, usedToday: 0 })).toEqual({ turnedOff: true })
  })
})
