import { z } from 'zod'

import { flowSummarySchema } from './flow'
import { mappingVersionSummarySchema } from './mapping-version'
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

export const directions = ['inbound', 'outbound'] as const

export const directionSchema = z.enum(directions)

export type Direction = z.infer<typeof directionSchema>

export const runStepStages = ['receipt', ...failureStages] as const

export const runStepStageSchema = z.enum(runStepStages)

export type RunStepStage = z.infer<typeof runStepStageSchema>

export const runStepStatuses = ['succeeded', 'failed', 'running', 'pending', 'skipped'] as const

export const runStepStatusSchema = z.enum(runStepStatuses)

export type RunStepStatus = z.infer<typeof runStepStatusSchema>

export const runStepSchema = z.object({
  stage: runStepStageSchema,
  status: runStepStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})

export type RunStep = z.infer<typeof runStepSchema>

export const errorPositionSchema = z.object({
  segment: z.number().int().min(1),
  tag: z.string().regex(/^[A-Z0-9]{3}$/),
  element: z.number().int().min(1).nullable(),
  component: z.number().int().min(1).nullable(),
})

export type ErrorPosition = z.infer<typeof errorPositionSchema>

export const runErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  position: errorPositionSchema.nullable(),
})

export type RunError = z.infer<typeof runErrorSchema>

export const parsedSegmentSchema = z.object({
  tag: z.string().regex(/^[A-Z0-9]{3}$/),
  name: z.string().min(1).nullable(),
  elements: z.array(z.array(z.string())),
})

export type ParsedSegment = z.infer<typeof parsedSegmentSchema>

export const parsedMessageSchema = z.object({
  reference: z.string().min(1),
  messageType: messageTypeSchema,
  segments: z.array(parsedSegmentSchema).min(1),
})

export type ParsedMessage = z.infer<typeof parsedMessageSchema>

export const runInterchangeSchema = z.object({
  id: z.uuid(),
  controlReference: z.string().min(1).max(14),
  raw: z.string().min(1),
})

export type RunInterchange = z.infer<typeof runInterchangeSchema>

const runDetailFields = {
  direction: directionSchema,
  steps: z.array(runStepSchema).min(1),
  interchange: runInterchangeSchema.nullable(),
  message: parsedMessageSchema.nullable(),
  mappingVersion: mappingVersionSummarySchema.nullable(),
  replaces: z.object({ id: z.uuid() }).nullable(),
  replacedBy: z.object({ id: z.uuid() }).nullable(),
}

export const runDetailSchema = z.discriminatedUnion('status', [
  runSummaryBaseSchema.extend({
    ...runDetailFields,
    status: z.literal('failed'),
    failureStage: failureStageSchema,
    error: runErrorSchema,
  }),
  runSummaryBaseSchema.extend({
    ...runDetailFields,
    status: runStatusSchema.exclude(['failed']),
    failureStage: z.null(),
    error: z.null(),
  }),
])

export type RunDetail = z.infer<typeof runDetailSchema>

export const runEndpoint: Endpoint<RunDetail, undefined, undefined, '/runs/:id'> = {
  method: 'GET',
  path: '/runs/:id',
  response: runDetailSchema,
}

export const retryRunEndpoint: Endpoint<RunDetail, undefined, undefined, '/runs/:id/retry'> = {
  method: 'POST',
  path: '/runs/:id/retry',
  response: runDetailSchema,
}

export const reprocessRunBodySchema = z.object({
  mappingVersionId: z.uuid(),
})

export type ReprocessRunBody = z.infer<typeof reprocessRunBodySchema>

export const reprocessRunEndpoint: Endpoint<
  RunDetail,
  undefined,
  ReprocessRunBody,
  '/runs/:id/reprocess'
> = {
  method: 'POST',
  path: '/runs/:id/reprocess',
  body: reprocessRunBodySchema,
  response: runDetailSchema,
}
