import { errorRate, type OverviewWindow, type ThroughputBucket } from '@edi-bridge/contracts'

export type BucketRow = {
  start: string
  end: string
  delivered: number
  failed: number
  errorRate: number | null
  inProgress: boolean
}

export function toBucketRows(
  throughput: ReadonlyArray<ThroughputBucket>,
  asOf: number,
): BucketRow[] {
  return throughput.map((bucket) => ({
    ...bucket,
    errorRate: errorRate(bucket),
    inProgress: Date.parse(bucket.end) > asOf,
  }))
}

export function totalsOf(rows: ReadonlyArray<BucketRow>) {
  const delivered = rows.reduce((sum, row) => sum + row.delivered, 0)
  const failed = rows.reduce((sum, row) => sum + row.failed, 0)

  return {
    delivered,
    failed,
    finished: delivered + failed,
    errorRate: errorRate({ delivered, failed }),
  }
}

export type Totals = ReturnType<typeof totalsOf>

export type OverviewSeries = {
  rows: BucketRow[]
  totals: Totals
  timeWindow: OverviewWindow
}

export function peakOf<Row>(rows: ReadonlyArray<Row>, value: (row: Row) => number | null) {
  let peak: Row | undefined

  for (const row of rows) {
    if ((value(row) ?? -1) > (peak === undefined ? -1 : (value(peak) ?? -1))) {
      peak = row
    }
  }

  return peak
}

export function rateTicks(rows: ReadonlyArray<BucketRow>) {
  const max = Math.max(0, ...rows.map((row) => row.errorRate ?? 0))
  const step = max <= 0.2 ? 0.05 : max <= 0.5 ? 0.1 : 0.25
  const count = Math.max(1, Math.ceil(max / step))

  return Array.from({ length: count + 1 }, (_, index) => Math.round(index * step * 100) / 100)
}

const timeOfDay = { hour: 'numeric', minute: '2-digit' } as const

export const tickFormats = {
  '1h': timeOfDay,
  '24h': timeOfDay,
  '7d': { weekday: 'short', ...timeOfDay },
} as const satisfies Record<OverviewWindow, Intl.DateTimeFormatOptions>

export const rangeFormats = {
  '1h': timeOfDay,
  '24h': timeOfDay,
  '7d': { weekday: 'short', day: 'numeric', month: 'short', ...timeOfDay },
} as const satisfies Record<OverviewWindow, Intl.DateTimeFormatOptions>
