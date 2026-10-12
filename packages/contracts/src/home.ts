import { z } from 'zod'

import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'
import type { TaskCounts } from './task'

export const homeWindows = ['24h', '7d', '30d'] as const

export const homeWindowSchema = z.enum(homeWindows)

export type HomeWindow = z.infer<typeof homeWindowSchema>

const day = 24 * 60

export const homeWindowSizes = {
  '24h': { durationMinutes: day, bucketMinutes: 60 },
  '7d': { durationMinutes: 7 * day, bucketMinutes: day },
  '30d': { durationMinutes: 30 * day, bucketMinutes: day },
} as const satisfies Record<HomeWindow, { durationMinutes: number; bucketMinutes: number }>

export const homeQuerySchema = z.object({
  window: homeWindowSchema.default('24h'),
})

export type HomeQuery = z.output<typeof homeQuerySchema>

const countSchema = z.number().int().min(0)

export const finishedRunCountsSchema = z.object({
  delivered: countSchema,
  failed: countSchema,
})

export type FinishedRunCounts = z.infer<typeof finishedRunCountsSchema>

export const throughputBucketSchema = finishedRunCountsSchema.extend({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
})

export type ThroughputBucket = z.infer<typeof throughputBucketSchema>

export function errorRate({ delivered, failed }: FinishedRunCounts) {
  const finished = delivered + failed

  return finished === 0 ? null : failed / finished
}

// Only delivered counts the window: the others are open now, so each card matches the list it opens.
export const homeKeyNumbersSchema = z.object({
  needsAttention: countSchema,
  delivered: countSchema,
  inProgress: countSchema,
  waitingForTradingPartner: countSchema,
})

export type HomeKeyNumbers = z.infer<typeof homeKeyNumbersSchema>

export const homeTradingPartnerSchema = z.object({
  tradingPartner: tradingPartnerSummarySchema,
  testMode: z.boolean(),
  documentsToday: countSchema,
  openProblems: countSchema,
})

export type HomeTradingPartner = z.infer<typeof homeTradingPartnerSchema>

export const homeSchema = z.object({
  window: homeWindowSchema,
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  keyNumbers: homeKeyNumbersSchema,
  throughput: z.array(throughputBucketSchema),
  tradingPartners: z.array(homeTradingPartnerSchema),
})

export type Home = z.infer<typeof homeSchema>

export const homeEndpoint: Endpoint<Home, HomeQuery> = {
  method: 'GET',
  path: '/home',
  query: homeQuerySchema,
  response: homeSchema,
}

export function homeKeyNumbersOf(
  counts: TaskCounts,
  { delivered, inProgress }: Pick<HomeKeyNumbers, 'delivered' | 'inProgress'>,
): HomeKeyNumbers {
  return {
    needsAttention: counts.you + counts.retry,
    delivered,
    inProgress,
    waitingForTradingPartner: counts.tradingPartner,
  }
}
