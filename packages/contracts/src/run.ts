import { z } from 'zod'

import { flowSummarySchema } from './flow'
import { messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const runStatuses = ['received', 'processing', 'delivered', 'failed', 'duplicate'] as const

export const runStatusSchema = z.enum(runStatuses)

export type RunStatus = z.infer<typeof runStatusSchema>

export const failureStages = ['parse', 'validation', 'mapping', 'delivery'] as const

export const failureStageSchema = z.enum(failureStages)

export type FailureStage = z.infer<typeof failureStageSchema>

const runSummaryBaseSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  tradingPartner: tradingPartnerSummarySchema,
  messageType: messageTypeSchema,
  flow: flowSummarySchema.pick({ id: true, name: true }),
  manualSubmission: z.boolean(),
})

export const runSummarySchema = z.discriminatedUnion('status', [
  runSummaryBaseSchema.extend({
    status: z.literal('failed'),
    failureStage: failureStageSchema,
  }),
  runSummaryBaseSchema.extend({
    status: runStatusSchema.exclude(['failed']),
    failureStage: z.null(),
  }),
])

export type RunSummary = z.infer<typeof runSummarySchema>

function many<Item extends z.ZodType>(item: Item) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : [value].flat()),
    z.array(item).optional(),
  )
}

export const runListQuerySchema = z.object({
  status: many(runStatusSchema),
  failureStage: many(failureStageSchema),
  tradingPartnerId: many(z.uuid()),
  messageType: many(messageTypeSchema),
  flowId: many(z.uuid()),
  receivedFrom: z.iso.datetime().optional(),
  receivedTo: z.iso.datetime().optional(),
  manualSubmission: z.stringbool().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export type RunListQuery = z.output<typeof runListQuerySchema>

export const runListSchema = z.object({
  runs: z.array(runSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})

export type RunList = z.infer<typeof runListSchema>

export const runsEndpoint: Endpoint<RunList, RunListQuery> = {
  method: 'GET',
  path: '/runs',
  query: runListQuerySchema,
  response: runListSchema,
}
