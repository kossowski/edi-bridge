import {
  type AiTokenBudget,
  aiDailyTokenLimit,
  aiDailyTokenLimitSchema,
  documentRetentionDays,
  documentRetentionDaysSchema,
  type WorkspaceSettings,
  type WorkspaceSettingsInput,
} from '@edi-bridge/contracts'

import { fieldErrors, type FormIssue } from './field-errors'

export type WholeNumberError = 'required' | 'notWhole' | 'outOfRange'

export const workspaceSettingsFields = {
  documentRetentionDays: {
    messages: 'retention',
    bounds: documentRetentionDays,
    schema: documentRetentionDaysSchema,
    of: (settings: WorkspaceSettings) => settings.documentRetentionDays,
  },
  dailyLimit: {
    messages: 'budget',
    bounds: aiDailyTokenLimit,
    schema: aiDailyTokenLimitSchema,
    of: (settings: WorkspaceSettings) => settings.aiTokenBudget.dailyLimit,
  },
} as const

export type WorkspaceSettingsField = keyof typeof workspaceSettingsFields

export const workspaceSettingsFieldNames = [
  'documentRetentionDays',
  'dailyLimit',
] as const satisfies ReadonlyArray<WorkspaceSettingsField>

export type WorkspaceSettingsValues = Record<WorkspaceSettingsField, string>

export type WorkspaceSettingsErrors = Partial<Record<WorkspaceSettingsField, WholeNumberError>>

export type WorkspaceSettingsResult =
  | { input: WorkspaceSettingsInput }
  | { errors: WorkspaceSettingsErrors }

export function groupSeparatorOf(locale: string) {
  return new Intl.NumberFormat(locale).formatToParts(1000).find((part) => part.type === 'group')
    ?.value
}

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

export function parseWholeNumber(value: string, groupSeparator: string | undefined) {
  const compact = value.replaceAll(/\s/g, '')

  if (/^\d+$/.test(compact)) {
    return Number(compact)
  }

  if (groupSeparator === undefined || /\s/.test(groupSeparator)) {
    return null
  }

  const grouped = new RegExp(String.raw`^\d{1,3}(${escapeRegExp(groupSeparator)}\d{3})+$`)

  return grouped.test(compact) ? Number(compact.replaceAll(groupSeparator, '')) : null
}

function errorOf(value: string, groupSeparator: string | undefined): WholeNumberError {
  if (value.trim() === '') {
    return 'required'
  }

  return parseWholeNumber(value, groupSeparator) === null ? 'notWhole' : 'outOfRange'
}

function parseField(
  field: WorkspaceSettingsField,
  values: WorkspaceSettingsValues,
  groupSeparator: string | undefined,
) {
  return workspaceSettingsFields[field].schema.safeParse(
    parseWholeNumber(values[field], groupSeparator) ?? undefined,
  )
}

export function validateWorkspaceSettings(
  values: WorkspaceSettingsValues,
  groupSeparator: string | undefined,
): WorkspaceSettingsResult {
  const days = parseField('documentRetentionDays', values, groupSeparator)
  const dailyLimit = parseField('dailyLimit', values, groupSeparator)

  if (days.success && dailyLimit.success) {
    return {
      input: { documentRetentionDays: days.data, aiTokenBudget: { dailyLimit: dailyLimit.data } },
    }
  }

  const issues: FormIssue[] = [
    ...(days.error?.issues.map(({ code }) => ({ code, path: ['documentRetentionDays'] })) ?? []),
    ...(dailyLimit.error?.issues.map(({ code }) => ({ code, path: ['dailyLimit'] })) ?? []),
  ]

  return {
    errors: fieldErrors(issues, workspaceSettingsFieldNames, (field) =>
      errorOf(values[field], groupSeparator),
    ),
  }
}

export function toWorkspaceSettingsValues(
  settings: WorkspaceSettings,
  formatNumber: (value: number) => string,
): WorkspaceSettingsValues {
  return {
    documentRetentionDays: formatNumber(workspaceSettingsFields.documentRetentionDays.of(settings)),
    dailyLimit: formatNumber(workspaceSettingsFields.dailyLimit.of(settings)),
  }
}

export type BudgetUsage =
  | { turnedOff: true }
  | { turnedOff: false; exhausted: boolean; share: number; filled: number }

export function budgetUsage({ dailyLimit, usedToday }: AiTokenBudget): BudgetUsage {
  if (dailyLimit === 0) {
    return { turnedOff: true }
  }

  const share = usedToday / dailyLimit

  return { turnedOff: false, exhausted: share >= 1, share, filled: Math.min(share, 1) }
}
