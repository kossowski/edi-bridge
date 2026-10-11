import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { directionSchema, messageTypeSchema } from './message-type'
import { failureStageSchema, runReferenceSchema, runStatusSchema } from './run'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const orderLifecycleMessageTypes = ['ORDERS', 'DESADV', 'INVOIC'] as const

export const orderLifecycleMessageTypeSchema = messageTypeSchema.extract(orderLifecycleMessageTypes)

export type OrderLifecycleMessageType = z.infer<typeof orderLifecycleMessageTypeSchema>

export const acknowledgementStates = ['pending', 'accepted', 'rejected', 'overdue'] as const

export const acknowledgementStateSchema = z.enum(acknowledgementStates)

export type AcknowledgementState = z.infer<typeof acknowledgementStateSchema>

export const businessReferenceSchema = z.string().trim().min(1).max(35)

export const orderLifecycleQuerySchema = z.object({
  businessReference: businessReferenceSchema,
})

export type OrderLifecycleQuery = z.output<typeof orderLifecycleQuerySchema>

const lifecycleRunBaseSchema = z.object({
  id: z.uuid(),
  replacedBy: runReferenceSchema.nullable(),
})

export const orderLifecycleRunSchema = z.discriminatedUnion('status', [
  lifecycleRunBaseSchema.extend({
    status: z.literal('failed'),
    failureStage: failureStageSchema,
  }),
  lifecycleRunBaseSchema.extend({
    status: runStatusSchema.exclude(['failed']),
    failureStage: z.null(),
  }),
])

export type OrderLifecycleRun = z.infer<typeof orderLifecycleRunSchema>

export const orderLifecycleInterchangeSchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
  acknowledgement: acknowledgementStateSchema.nullable(),
})

export type OrderLifecycleInterchange = z.infer<typeof orderLifecycleInterchangeSchema>

export const orderLifecycleMessageSchema = z.object({
  messageType: orderLifecycleMessageTypeSchema,
  direction: directionSchema,
  receivedAt: z.iso.datetime(),
  run: orderLifecycleRunSchema,
  interchange: orderLifecycleInterchangeSchema.nullable(),
})

export type OrderLifecycleMessage = z.infer<typeof orderLifecycleMessageSchema>

export const orderLifecycleSchema = z.object({
  businessReference: businessReferenceSchema,
  tradingPartner: tradingPartnerSummarySchema,
  messages: z.array(orderLifecycleMessageSchema),
})

export type OrderLifecycle = z.infer<typeof orderLifecycleSchema>

export const orderLifecycleListSchema = z.array(orderLifecycleSchema)

export function openMessageTypes(
  messages: ReadonlyArray<Pick<OrderLifecycleMessage, 'messageType'>>,
): OrderLifecycleMessageType[] {
  return orderLifecycleMessageTypes.filter(
    (messageType) => !messages.some((message) => message.messageType === messageType),
  )
}

export const orderLifecyclesEndpoint: Endpoint<OrderLifecycle[], OrderLifecycleQuery> = {
  method: 'GET',
  path: '/order-lifecycles',
  query: orderLifecycleQuerySchema,
  response: orderLifecycleListSchema,
}
