import { z } from 'zod'

import type { Endpoint } from './endpoint'

export const documentRetentionDays = { min: 7, max: 730, default: 90 } as const

export const aiDailyTokenLimit = { min: 0, max: 10_000_000, default: 200_000 } as const

const tokenCountSchema = z.number().int().min(0)

export const documentRetentionDaysSchema = z
  .number()
  .int()
  .min(documentRetentionDays.min)
  .max(documentRetentionDays.max)

export const aiDailyTokenLimitSchema = z
  .number()
  .int()
  .min(aiDailyTokenLimit.min)
  .max(aiDailyTokenLimit.max)

export const aiTokenBudgetSchema = z.object({
  dailyLimit: aiDailyTokenLimitSchema,
  usedToday: tokenCountSchema,
})

export type AiTokenBudget = z.infer<typeof aiTokenBudgetSchema>

export const workspaceSettingsSchema = z.object({
  documentRetentionDays: documentRetentionDaysSchema,
  aiTokenBudget: aiTokenBudgetSchema,
})

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>

export const workspaceSettingsInputSchema = z.object({
  documentRetentionDays: documentRetentionDaysSchema,
  aiTokenBudget: aiTokenBudgetSchema.pick({ dailyLimit: true }),
})

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsInputSchema>

export const workspaceSettingsEndpoint: Endpoint<WorkspaceSettings> = {
  method: 'GET',
  path: '/workspaces/current/settings',
  response: workspaceSettingsSchema,
}

export const updateWorkspaceSettingsEndpoint: Endpoint<
  WorkspaceSettings,
  undefined,
  WorkspaceSettingsInput,
  '/workspaces/current/settings'
> = {
  method: 'PUT',
  path: '/workspaces/current/settings',
  body: workspaceSettingsInputSchema,
  response: workspaceSettingsSchema,
}

export const operatorWorkspaceSettingsEndpoint: Endpoint<
  WorkspaceSettings,
  undefined,
  undefined,
  '/operator/workspaces/:workspaceId/settings'
> = {
  method: 'GET',
  path: '/operator/workspaces/:workspaceId/settings',
  response: workspaceSettingsSchema,
}

export const updateOperatorWorkspaceSettingsEndpoint: Endpoint<
  WorkspaceSettings,
  undefined,
  WorkspaceSettingsInput,
  '/operator/workspaces/:workspaceId/settings'
> = {
  method: 'PUT',
  path: '/operator/workspaces/:workspaceId/settings',
  body: workspaceSettingsInputSchema,
  response: workspaceSettingsSchema,
}
