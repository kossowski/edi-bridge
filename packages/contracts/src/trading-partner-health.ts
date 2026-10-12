import { z } from 'zod'

const countSchema = z.number().int().min(0)

export const finishedRunCountsSchema = z.object({
  delivered: countSchema,
  failed: countSchema,
})

export type FinishedRunCounts = z.infer<typeof finishedRunCountsSchema>

export function errorRate({ delivered, failed }: FinishedRunCounts) {
  const finished = delivered + failed

  return finished === 0 ? null : failed / finished
}

export const healthStatuses = ['healthy', 'degraded', 'failing'] as const

export type HealthStatus = (typeof healthStatuses)[number]

export const healthThresholds = { degraded: 0.1, failing: 0.25 } as const

export function healthStatusOf({
  delivered,
  failed,
  overdue,
}: FinishedRunCounts & { overdue: number }): HealthStatus {
  const rate = errorRate({ delivered, failed }) ?? 0

  if (rate >= healthThresholds.failing) {
    return 'failing'
  }

  return rate >= healthThresholds.degraded || overdue > 0 ? 'degraded' : 'healthy'
}
