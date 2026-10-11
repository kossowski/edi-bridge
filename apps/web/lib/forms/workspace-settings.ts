import {
  type AiTokenBudget,
  aiDailyTokenLimit,
  documentRetentionDays,
  type WorkspaceSettingsInput,
} from '@edi-bridge/contracts'

export type WholeNumberError = 'required' | 'notWhole' | 'outOfRange'

export type WorkspaceSettingsValues = {
  documentRetentionDays: string
  dailyLimit: string
}

export type WorkspaceSettingsErrors = Partial<
  Record<keyof WorkspaceSettingsValues, WholeNumberError>
>

export function parseWholeNumber(value: string) {
  const compact = value.trim().replaceAll(/\s/g, '')

  if (/^\d+$/.test(compact)) {
    return Number(compact)
  }

  return /^\d{1,3}([.,'’]\d{3})+$/.test(compact) ? Number(compact.replaceAll(/\D/g, '')) : null
}

export function wholeNumberError(
  value: string,
  bounds: { min: number; max: number },
): WholeNumberError | null {
  if (value.trim() === '') {
    return 'required'
  }

  const number = parseWholeNumber(value)

  if (number === null) {
    return 'notWhole'
  }

  return number < bounds.min || number > bounds.max ? 'outOfRange' : null
}

export function workspaceSettingsErrors(values: WorkspaceSettingsValues): WorkspaceSettingsErrors {
  const errors: WorkspaceSettingsErrors = {}
  const retention = wholeNumberError(values.documentRetentionDays, documentRetentionDays)
  const dailyLimit = wholeNumberError(values.dailyLimit, aiDailyTokenLimit)

  if (retention) {
    errors.documentRetentionDays = retention
  }

  if (dailyLimit) {
    errors.dailyLimit = dailyLimit
  }

  return errors
}

export function toWorkspaceSettingsInput(values: WorkspaceSettingsValues): WorkspaceSettingsInput {
  return {
    documentRetentionDays: parseWholeNumber(values.documentRetentionDays) ?? Number.NaN,
    aiTokenBudget: { dailyLimit: parseWholeNumber(values.dailyLimit) ?? Number.NaN },
  }
}

export function budgetUsage({ dailyLimit, usedToday }: AiTokenBudget) {
  return {
    off: dailyLimit === 0,
    exhausted: usedToday >= dailyLimit,
    share: dailyLimit === 0 ? 1 : Math.min(usedToday / dailyLimit, 1),
  }
}
