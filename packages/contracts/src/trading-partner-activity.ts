import { z } from 'zod'

import { flowSummarySchema } from './flow'
import { overdueAcknowledgementSchema } from './overdue-acknowledgement'
import { runSummarySchema } from './run'

import type { Endpoint } from './endpoint'

const countSchema = z.number().int().min(0)

export const activityDays = 7

export const openProblemListLimit = 20

export const tradingPartnerActivitySchema = z.object({
  tradingPartnerId: z.uuid(),
  runsToday: countSchema,
  openProblems: countSchema,
  lastActivityAt: z.iso.datetime().nullable(),
  channelCount: countSchema,
  flowCount: countSchema,
})

export type TradingPartnerActivity = z.infer<typeof tradingPartnerActivitySchema>

export const activityDaySchema = z.object({
  date: z.iso.date(),
  runs: countSchema,
  failed: countSchema,
})

export type ActivityDay = z.infer<typeof activityDaySchema>

export const flowActivitySchema = z.object({
  flow: flowSummarySchema.pick({ id: true, name: true }),
  runs: countSchema,
})

export type FlowActivity = z.infer<typeof flowActivitySchema>

export const openProblemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('failedRun'), run: runSummarySchema }),
  z.object({
    kind: z.literal('overdueAcknowledgement'),
    overdueAcknowledgement: overdueAcknowledgementSchema,
  }),
])

export type OpenProblem = z.infer<typeof openProblemSchema>

export const tradingPartnerActivityDetailSchema = tradingPartnerActivitySchema.extend({
  days: z.array(activityDaySchema).length(activityDays),
  flows: z.array(flowActivitySchema),
  problems: z.array(openProblemSchema).max(openProblemListLimit),
})

export type TradingPartnerActivityDetail = z.infer<typeof tradingPartnerActivityDetailSchema>

export const tradingPartnerActivitiesEndpoint: Endpoint<
  TradingPartnerActivity[],
  undefined,
  undefined,
  '/trading-partners/activity'
> = {
  method: 'GET',
  path: '/trading-partners/activity',
  response: z.array(tradingPartnerActivitySchema),
}

export const tradingPartnerActivityEndpoint: Endpoint<
  TradingPartnerActivityDetail,
  undefined,
  undefined,
  '/trading-partners/:id/activity'
> = {
  method: 'GET',
  path: '/trading-partners/:id/activity',
  response: tradingPartnerActivityDetailSchema,
}
