import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { messageTypeSchema } from './message-type'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const overviewWindows = ['1h', '24h', '7d'] as const

export const overviewWindowSchema = z.enum(overviewWindows)

export type OverviewWindow = z.infer<typeof overviewWindowSchema>

export const overviewWindowSizes = {
  '1h': { durationMinutes: 60, bucketMinutes: 5 },
  '24h': { durationMinutes: 24 * 60, bucketMinutes: 60 },
  '7d': { durationMinutes: 7 * 24 * 60, bucketMinutes: 6 * 60 },
} as const satisfies Record<OverviewWindow, { durationMinutes: number; bucketMinutes: number }>

export const overviewQuerySchema = z.object({
  window: overviewWindowSchema.default('24h'),
})

export type OverviewQuery = z.output<typeof overviewQuerySchema>

const countSchema = z.number().int().min(0)

export const throughputBucketSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  delivered: countSchema,
  failed: countSchema,
})

export type ThroughputBucket = z.infer<typeof throughputBucketSchema>

export function errorRate({ delivered, failed }: { delivered: number; failed: number }) {
  const finished = delivered + failed

  return finished === 0 ? null : failed / finished
}

export const healthStatuses = ['healthy', 'degraded', 'failing'] as const

export const healthStatusSchema = z.enum(healthStatuses)

export type HealthStatus = z.infer<typeof healthStatusSchema>

export const healthThresholds = { degraded: 0.1, failing: 0.25 } as const

export function healthStatusOf({
  delivered,
  failed,
  overdue,
}: {
  delivered: number
  failed: number
  overdue: number
}): HealthStatus {
  const rate = errorRate({ delivered, failed }) ?? 0

  if (rate >= healthThresholds.failing) {
    return 'failing'
  }

  return rate >= healthThresholds.degraded || overdue > 0 ? 'degraded' : 'healthy'
}

export const tradingPartnerHealthSchema = z.object({
  tradingPartner: tradingPartnerSummarySchema,
  status: healthStatusSchema,
  delivered: countSchema,
  failed: countSchema,
  overdue: countSchema,
  lastRunAt: z.iso.datetime().nullable(),
})

export type TradingPartnerHealth = z.infer<typeof tradingPartnerHealthSchema>

export const overdueAcknowledgementSchema = z.object({
  interchange: z.object({ id: z.uuid(), controlReference: controlReferenceSchema }),
  tradingPartner: tradingPartnerSummarySchema,
  messageType: messageTypeSchema.extract(['DESADV', 'INVOIC']),
  sentAt: z.iso.datetime(),
  acknowledgementTimeLimitHours: z.number().int().min(1),
  overdueSince: z.iso.datetime(),
})

export type OverdueAcknowledgement = z.infer<typeof overdueAcknowledgementSchema>

export const overviewSchema = z.object({
  window: overviewWindowSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  throughput: z.array(throughputBucketSchema),
  tradingPartners: z.array(tradingPartnerHealthSchema),
  overdueAcknowledgements: z.array(overdueAcknowledgementSchema),
})

export type Overview = z.infer<typeof overviewSchema>

export const overviewEndpoint: Endpoint<Overview, OverviewQuery> = {
  method: 'GET',
  path: '/overview',
  query: overviewQuerySchema,
  response: overviewSchema,
}
