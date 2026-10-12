import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { directionOf, type MessageType, messageTypeSchema } from './message-type'
import { overdueAcknowledgementMessageTypes } from './overview'
import { type FailureStage, failureStageSchema } from './run'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const taskActors = ['you', 'retry', 'partner'] as const

export const taskActorSchema = z.enum(taskActors)

export type TaskActor = z.infer<typeof taskActorSchema>

export const runTaskTargetSchema = z.object({ kind: z.literal('run'), runId: z.uuid() })

export const interchangeTaskTargetSchema = z.object({
  kind: z.literal('interchange'),
  interchangeId: z.uuid(),
})

export const tradingPartnerTaskTargetSchema = z.object({
  kind: z.literal('tradingPartner'),
  tradingPartnerId: z.uuid(),
})

export const taskTargetSchema = z.discriminatedUnion('kind', [
  runTaskTargetSchema,
  interchangeTaskTargetSchema,
  tradingPartnerTaskTargetSchema,
])

export type TaskTarget = z.infer<typeof taskTargetSchema>

const countSchema = z.number().int().min(0)

const taskBaseSchema = z.object({
  id: z.string().min(1),
  tradingPartner: tradingPartnerSummarySchema,
  at: z.iso.datetime(),
})

export const failedRunTaskSchema = taskBaseSchema.extend({
  kind: z.literal('failedRun'),
  whoActs: taskActorSchema,
  run: z.object({
    id: z.uuid(),
    messageType: messageTypeSchema,
    failureStage: failureStageSchema,
  }),
  target: runTaskTargetSchema,
})

export const overdueAcknowledgementTaskSchema = taskBaseSchema.extend({
  kind: z.literal('overdueAcknowledgement'),
  whoActs: z.literal('partner'),
  interchange: z.object({ id: z.uuid(), controlReference: controlReferenceSchema }),
  messageType: messageTypeSchema.extract(overdueAcknowledgementMessageTypes),
  sentAt: z.iso.datetime(),
  acknowledgementTimeLimitHours: z.number().int().min(1),
  target: interchangeTaskTargetSchema,
})

export const failingTradingPartnerTaskSchema = taskBaseSchema.extend({
  kind: z.literal('failingTradingPartner'),
  whoActs: z.literal('you'),
  delivered: countSchema,
  failed: countSchema,
  target: tradingPartnerTaskTargetSchema,
})

export const taskSchema = z.discriminatedUnion('kind', [
  failedRunTaskSchema,
  overdueAcknowledgementTaskSchema,
  failingTradingPartnerTaskSchema,
])

export type Task = z.infer<typeof taskSchema>

export type TaskKind = Task['kind']

export const taskCountsSchema = z.object({
  you: countSchema,
  retry: countSchema,
  partner: countSchema,
})

export type TaskCounts = z.infer<typeof taskCountsSchema>

export const tasksSchema = z.object({
  tasks: z.array(taskSchema),
  counts: taskCountsSchema,
})

export type Tasks = z.infer<typeof tasksSchema>

export const tasksEndpoint: Endpoint<Tasks> = {
  method: 'GET',
  path: '/tasks',
  response: tasksSchema,
}

export function whoActsOnFailedRun({
  failureStage,
  messageType,
}: {
  failureStage: FailureStage
  messageType: MessageType
}): TaskActor {
  switch (failureStage) {
    case 'delivery': {
      return 'retry'
    }

    case 'mapping': {
      return 'you'
    }

    case 'parse':
    case 'validation': {
      // Outbound EDIFACT comes from our own Mapping, so only an inbound file is the partner's to resend.
      return directionOf({ messageType }) === 'inbound' ? 'partner' : 'you'
    }
  }
}

export function taskCountsOf(tasks: ReadonlyArray<Pick<Task, 'whoActs'>>): TaskCounts {
  const counts: TaskCounts = { you: 0, retry: 0, partner: 0 }

  for (const { whoActs } of tasks) {
    counts[whoActs] += 1
  }

  return counts
}
