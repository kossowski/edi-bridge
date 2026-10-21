import { z } from 'zod'

import { blockedAddressSchema } from './channel'
import { controlReferenceSchema, segmentTagSchema } from './edifact'
import { flowSummarySchema } from './flow'
import { listPageFields, listQueryFields, many } from './list'
import { mappingVersionSummarySchema } from './mapping-version'
import { type Direction, directionSchema, messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const runStatuses = ['received', 'processing', 'delivered', 'failed', 'duplicate'] as const

export const runStatusSchema = z.enum(runStatuses)

export type RunStatus = z.infer<typeof runStatusSchema>

export const failureStages = ['parse', 'validation', 'mapping', 'delivery'] as const

export const failureStageSchema = z.enum(failureStages)

export type FailureStage = z.infer<typeof failureStageSchema>

export const problemReasons = [
  'unreadable',
  'invalidContent',
  'missingCode',
  'missingField',
  'unreachable',
  'hostKeyMismatch',
  'addressBlocked',
  'incompleteSetup',
  'defect',
] as const

export const problemReasonSchema = z.enum(problemReasons)

export type ProblemReason = z.infer<typeof problemReasonSchema>

export const fixers = ['you', 'retry', 'tradingPartner'] as const

export const fixerSchema = z.enum(fixers)

export type Fixer = z.infer<typeof fixerSchema>

export function whoFixes(run: {
  failureStage: FailureStage | null
  direction: Direction
  problem: { reason: ProblemReason } | null
}): Fixer | null {
  // A Defect is fixed by trying again at any Failure Stage: Retry at delivery,
  // Reprocess with the Run's own Mapping Version at any other stage.
  if (run.failureStage !== null && run.problem?.reason === 'defect') {
    return 'retry'
  }

  switch (run.failureStage) {
    case null: {
      return null
    }

    case 'delivery': {
      // A retry fails until an Admin accepts the server's new host key or changes the Channel's host.
      return run.problem?.reason === 'hostKeyMismatch' || run.problem?.reason === 'addressBlocked'
        ? 'you'
        : 'retry'
    }

    case 'parse':
    case 'validation': {
      return run.direction === 'inbound' ? 'tradingPartner' : 'you'
    }

    case 'mapping': {
      return 'you'
    }
  }
}

export const interchangeReferenceSchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
})

export type InterchangeReference = z.infer<typeof interchangeReferenceSchema>

const runSummaryBaseSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  tradingPartner: tradingPartnerSummarySchema,
  messageType: messageTypeSchema,
  direction: directionSchema,
  flow: flowSummarySchema.pick({ id: true, name: true }),
  manualSubmission: z.boolean(),
  businessReference: z.string().min(1).nullable(),
  interchange: interchangeReferenceSchema.nullable(),
})

export const runSummarySchema = z.discriminatedUnion('status', [
  runSummaryBaseSchema.extend({
    status: z.literal('failed'),
    failureStage: failureStageSchema,
    problem: z.object({ reason: problemReasonSchema }),
  }),
  runSummaryBaseSchema.extend({
    status: runStatusSchema.exclude(['failed']),
    failureStage: z.null(),
    problem: z.null(),
  }),
])

export type RunSummary = z.infer<typeof runSummarySchema>

export const runListQuerySchema = z.object({
  status: many(runStatusSchema),
  failureStage: many(failureStageSchema),
  tradingPartnerId: many(z.uuid()),
  messageType: many(messageTypeSchema),
  flowId: many(z.uuid()),
  mappingId: many(z.uuid()).describe(
    'Runs whose recorded Mapping Version belongs to one of these Mappings; a Run not yet processed uses the Mapping Version its Flow is pinned to',
  ),
  receivedFrom: z.iso.datetime().optional(),
  receivedTo: z.iso.datetime().optional(),
  manualSubmission: z.stringbool().optional(),
  ...listQueryFields,
})

export type RunListQuery = z.output<typeof runListQuerySchema>

export const runListSchema = z.object({
  runs: z.array(runSummarySchema),
  statusCounts: z.record(runStatusSchema, z.number().int().min(0)),
  ...listPageFields,
})

export type RunList = z.infer<typeof runListSchema>

export const runsEndpoint: Endpoint<RunList, RunListQuery> = {
  method: 'GET',
  path: '/runs',
  query: runListQuerySchema,
  response: runListSchema,
}

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
  tag: segmentTagSchema,
  element: z.number().int().min(1).nullable(),
  component: z.number().int().min(1).nullable(),
})

export type ErrorPosition = z.infer<typeof errorPositionSchema>

export const runErrorDetailsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('httpResponse'),
    status: z.number().int().min(100).max(599),
  }),
  z.object({
    kind: z.literal('blockedAddress'),
    address: blockedAddressSchema,
  }),
])

export type RunErrorDetails = z.infer<typeof runErrorDetailsSchema>

export const runErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  position: errorPositionSchema.nullable(),
  details: runErrorDetailsSchema.nullable(),
})

export type RunError = z.infer<typeof runErrorSchema>

export const parsedSegmentSchema = z.object({
  tag: segmentTagSchema,
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

export const runInterchangeSchema = interchangeReferenceSchema.extend({
  raw: z.string().min(1),
})

export type RunInterchange = z.infer<typeof runInterchangeSchema>

export const runReferenceSchema = z.object({ id: z.uuid() })

export type RunReference = z.infer<typeof runReferenceSchema>

export const fixTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mapping'),
    mappingId: z.uuid(),
    name: z.string().min(1),
    fieldPath: z.string().min(1),
  }),
  z.object({
    kind: z.literal('lookupTable'),
    lookupTableId: z.uuid(),
    name: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal('channel'),
    channelId: z.uuid(),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('tradingPartner'),
    tradingPartnerId: z.uuid(),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('workspaceGln'),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('tradingPartnerGln'),
    tradingPartnerId: z.uuid(),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('channelCredential'),
    channelId: z.uuid(),
    name: z.string().min(1),
  }),
])

export type FixTarget = z.infer<typeof fixTargetSchema>

export const runProblemSchema = z.object({
  reason: problemReasonSchema,
  whoFixes: fixerSchema,
  fixTarget: fixTargetSchema.nullable(),
})

export type RunProblem = z.infer<typeof runProblemSchema>

const runDetailFields = {
  steps: z.array(runStepSchema).min(1),
  interchange: runInterchangeSchema.nullable(),
  message: parsedMessageSchema.nullable(),
  mappingVersion: mappingVersionSummarySchema.nullable(),
  replaces: runReferenceSchema.nullable(),
  replacedBy: runReferenceSchema.nullable(),
  documentDeletedAt: z.iso.datetime().nullable(),
  // Null once the Document expired, since its UNB held the indicator.
  testIndicator: z.boolean().nullable(),
}

const unfailedFields = {
  failureStage: z.null(),
  error: z.null(),
  problem: z.null(),
  waitingForTradingPartnerSince: z.null(),
}

export const runDetailSchema = z
  .discriminatedUnion('status', [
    runSummaryBaseSchema.extend({
      ...runDetailFields,
      status: z.literal('failed'),
      failureStage: failureStageSchema,
      error: runErrorSchema,
      problem: runProblemSchema,
      waitingForTradingPartnerSince: z.iso.datetime().nullable(),
      duplicateOf: z.null(),
    }),
    runSummaryBaseSchema.extend({
      ...runDetailFields,
      ...unfailedFields,
      status: z.literal('duplicate'),
      duplicateOf: runReferenceSchema.nullable(),
    }),
    runSummaryBaseSchema.extend({
      ...runDetailFields,
      ...unfailedFields,
      status: runStatusSchema.exclude(['failed', 'duplicate']),
      duplicateOf: z.null(),
    }),
  ])
  .superRefine((run, context) => {
    if (run.problem && run.problem.whoFixes !== whoFixes(run)) {
      context.addIssue({
        code: 'custom',
        path: ['problem', 'whoFixes'],
        message: 'Who fixes a problem follows from its reason, the Failure Stage and the direction',
      })
    }

    if (
      (run.problem?.reason === 'addressBlocked') !==
      (run.error?.details?.kind === 'blockedAddress')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error', 'details'],
        message: 'A Run fails with addressBlocked exactly when its error names the blocked address',
      })
    }

    if (run.waitingForTradingPartnerSince !== null && run.problem?.whoFixes !== 'tradingPartner') {
      context.addIssue({
        code: 'custom',
        path: ['waitingForTradingPartnerSince'],
        message: 'Only a Run that the Trading Partner fixes waits for the Trading Partner',
      })
    }
  })

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

export const waitForTradingPartnerRunEndpoint: Endpoint<
  RunDetail,
  undefined,
  undefined,
  '/runs/:id/wait-for-trading-partner'
> = {
  method: 'POST',
  path: '/runs/:id/wait-for-trading-partner',
  response: runDetailSchema,
}

export const endWaitingForTradingPartnerRunEndpoint: Endpoint<
  RunDetail,
  undefined,
  undefined,
  '/runs/:id/wait-for-trading-partner'
> = {
  method: 'DELETE',
  path: '/runs/:id/wait-for-trading-partner',
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
