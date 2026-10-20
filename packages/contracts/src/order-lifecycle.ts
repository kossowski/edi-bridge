import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { listPageFields, listQueryFields, many } from './list'
import { directionSchema, messageTypeSchema } from './message-type'
import { failureStageSchema, runReferenceSchema, runStatusSchema } from './run'
import { tradingPartnerInputSchema, tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const orderLifecycleMessageTypes = ['ORDERS', 'DESADV', 'INVOIC'] as const

export const orderLifecycleMessageTypeSchema = messageTypeSchema.extract(orderLifecycleMessageTypes)

export type OrderLifecycleMessageType = z.infer<typeof orderLifecycleMessageTypeSchema>

export const acknowledgementStates = ['pending', 'accepted', 'rejected', 'overdue'] as const

export const acknowledgementStateSchema = z.enum(acknowledgementStates)

export type AcknowledgementState = z.infer<typeof acknowledgementStateSchema>

export const acknowledgementNotSentReasons = [
  'noOutboundChannel',
  'ambiguousChannel',
  'workspaceGlnMissing',
  'unechoableInterchangeHeader',
  'seededChannel',
] as const

export const acknowledgementNotSentReasonSchema = z.enum(acknowledgementNotSentReasons)

export type AcknowledgementNotSentReason = z.infer<typeof acknowledgementNotSentReasonSchema>

export const businessReferenceSchema = z.string().trim().min(1).max(35)

const lifecycleRunBaseSchema = z.object({
  id: z.uuid(),
  replacedBy: runReferenceSchema.nullable(),
})

export const orderLifecycleRunSchema = z.discriminatedUnion('status', [
  lifecycleRunBaseSchema.extend({
    status: z.literal('failed'),
    failureStage: failureStageSchema,
    waitingForTradingPartnerSince: z.iso.datetime().nullable(),
  }),
  lifecycleRunBaseSchema.extend({
    status: runStatusSchema.exclude(['failed']),
    failureStage: z.null(),
    waitingForTradingPartnerSince: z.null(),
  }),
])

export type OrderLifecycleRun = z.infer<typeof orderLifecycleRunSchema>

export const orderLifecycleInterchangeSchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
  acknowledgement: acknowledgementStateSchema.nullable(),
  notSentReason: acknowledgementNotSentReasonSchema.nullable(),
})

export type OrderLifecycleInterchange = z.infer<typeof orderLifecycleInterchangeSchema>

export const orderLifecycleMessageSchema = z
  .object({
    messageType: orderLifecycleMessageTypeSchema,
    direction: directionSchema,
    receivedAt: z.iso.datetime(),
    run: orderLifecycleRunSchema,
    interchange: orderLifecycleInterchangeSchema.nullable(),
  })
  .refine(
    ({ direction, interchange }) => direction === 'inbound' || interchange?.notSentReason == null,
    { message: 'Only a received Interchange has a not-sent reason', path: ['interchange'] },
  )

export type OrderLifecycleMessage = z.infer<typeof orderLifecycleMessageSchema>

export const orderLifecycleTradingPartnerSchema = tradingPartnerSummarySchema.extend(
  tradingPartnerInputSchema.pick({ acknowledgementTimeLimitHours: true }).shape,
)

export type OrderLifecycleTradingPartner = z.infer<typeof orderLifecycleTradingPartnerSchema>

export const orderLifecycleSchema = z.object({
  businessReference: businessReferenceSchema,
  tradingPartner: orderLifecycleTradingPartnerSchema,
  messages: z.array(orderLifecycleMessageSchema).min(1),
})

export type OrderLifecycle = z.infer<typeof orderLifecycleSchema>

export function oldestFirst<Item extends Pick<OrderLifecycleMessage, 'receivedAt'>>(
  items: ReadonlyArray<Item>,
): Item[] {
  return items.toSorted((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
}

export function openMessageTypes(
  messages: ReadonlyArray<Pick<OrderLifecycleMessage, 'messageType'>>,
): OrderLifecycleMessageType[] {
  return orderLifecycleMessageTypes.filter(
    (messageType) => !messages.some((message) => message.messageType === messageType),
  )
}

export const orderLifecycleStatuses = [
  'on-track',
  'needs-attention',
  'waiting-for-trading-partner',
  'done',
] as const

export const orderLifecycleStatusSchema = z.enum(orderLifecycleStatuses)

export type OrderLifecycleStatus = z.infer<typeof orderLifecycleStatusSchema>

export const orderLifecycleStepStates = [
  'open',
  'in-progress',
  'needs-attention',
  'waiting-for-trading-partner',
  'done',
] as const

export const orderLifecycleStepStateSchema = z.enum(orderLifecycleStepStates)

export type OrderLifecycleStepState = z.infer<typeof orderLifecycleStepStateSchema>

type StepMessage = Pick<OrderLifecycleMessage, 'messageType' | 'direction' | 'run' | 'interchange'>

function stepStateOf(messages: ReadonlyArray<StepMessage>): OrderLifecycleStepState {
  const current = messages.filter(
    ({ run }) => run.replacedBy === null && run.status !== 'duplicate',
  )

  if (current.length === 0) {
    return 'open'
  }

  const acknowledgements = current.map(({ interchange }) => interchange?.acknowledgement ?? null)

  if (
    current.some(
      ({ run, interchange }) =>
        (run.status === 'failed' && run.waitingForTradingPartnerSince === null) ||
        interchange?.notSentReason != null,
    ) ||
    acknowledgements.some((state) => state === 'rejected' || state === 'overdue')
  ) {
    return 'needs-attention'
  }

  if (current.some(({ run }) => run.status === 'failed') || acknowledgements.includes('pending')) {
    return 'waiting-for-trading-partner'
  }

  return current.every(
    ({ run, direction, interchange }) =>
      run.status === 'delivered' &&
      (direction === 'inbound' ||
        // A null acknowledgement means sent before Acknowledgements were tracked.
        (interchange !== null && (interchange.acknowledgement ?? 'accepted') === 'accepted')),
  )
    ? 'done'
    : 'in-progress'
}

export const orderLifecycleStepSchema = z.object({
  messageType: orderLifecycleMessageTypeSchema,
  state: orderLifecycleStepStateSchema,
})

export type OrderLifecycleStep = z.infer<typeof orderLifecycleStepSchema>

function stepsOf(messages: ReadonlyArray<StepMessage>): OrderLifecycleStep[] {
  return orderLifecycleMessageTypes.map((messageType) => ({
    messageType,
    state: stepStateOf(messages.filter((message) => message.messageType === messageType)),
  }))
}

function statusOfSteps(steps: ReadonlyArray<OrderLifecycleStep>): OrderLifecycleStatus {
  const states = steps.map(({ state }) => state)

  if (states.includes('needs-attention')) {
    return 'needs-attention'
  }

  if (states.includes('waiting-for-trading-partner')) {
    return 'waiting-for-trading-partner'
  }

  return states.every((state) => state === 'done') ? 'done' : 'on-track'
}

export function orderLifecycleStatusOf(messages: ReadonlyArray<StepMessage>): OrderLifecycleStatus {
  return statusOfSteps(stepsOf(messages))
}

export const orderLifecycleSummarySchema = z.object({
  businessReference: businessReferenceSchema,
  tradingPartner: tradingPartnerSummarySchema,
  status: orderLifecycleStatusSchema,
  startedAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
  steps: z.array(orderLifecycleStepSchema).length(orderLifecycleMessageTypes.length),
})

export type OrderLifecycleSummary = z.infer<typeof orderLifecycleSummarySchema>

export function toOrderLifecycleSummary({
  businessReference,
  tradingPartner,
  messages,
}: OrderLifecycle): OrderLifecycleSummary {
  const steps = stepsOf(messages)

  const ordered = oldestFirst(messages)

  return {
    businessReference,
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    status: statusOfSteps(steps),
    startedAt: ordered[0]!.receivedAt,
    lastActivityAt: ordered.at(-1)!.receivedAt,
    steps,
  }
}

export const orderLifecycleListQuerySchema = z.object({
  status: many(orderLifecycleStatusSchema),
  ...listQueryFields,
})

export type OrderLifecycleListQuery = z.output<typeof orderLifecycleListQuerySchema>

export const orderLifecycleListSchema = z.object({
  orderLifecycles: z.array(orderLifecycleSummarySchema),
  statusCounts: z.record(orderLifecycleStatusSchema, z.number().int().min(0)),
  ...listPageFields,
})

export type OrderLifecycleList = z.infer<typeof orderLifecycleListSchema>

export const orderLifecyclesEndpoint: Endpoint<OrderLifecycleList, OrderLifecycleListQuery> = {
  method: 'GET',
  path: '/order-lifecycles',
  query: orderLifecycleListQuerySchema,
  response: orderLifecycleListSchema,
}

export const orderLifecycleEndpoint: Endpoint<
  OrderLifecycle[],
  undefined,
  undefined,
  '/order-lifecycles/:businessReference'
> = {
  method: 'GET',
  path: '/order-lifecycles/:businessReference',
  response: z.array(orderLifecycleSchema),
}
