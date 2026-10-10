'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  type DotItemDotProps,
  Line,
  LineChart,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import {
  type BucketRow,
  peakOf,
  rangeFormats,
  rateTicks,
  tickFormats,
  totalsOf,
} from '@/components/overview/overview-data'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { type ChartConfig, ChartContainer, ChartTooltip } from '@edi-bridge/ui/components/chart'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'

import type { OverviewWindow } from '@edi-bridge/contracts'

const deliveredColor = 'var(--chart-1)'

const failedColor = 'var(--chart-2)'

const failedInk = 'color-mix(in oklab, var(--chart-2), black 45%)'

const failedHatch = `repeating-linear-gradient(-45deg, ${failedInk} 0 1.5px, ${failedColor} 1.5px 4px)`

const chartConfig = {
  delivered: { color: deliveredColor },
  failed: { color: failedColor },
  errorRate: { color: failedColor },
} satisfies ChartConfig

const chartClassName = 'aspect-auto h-64 w-full'

function useFormats(window: OverviewWindow) {
  const format = useFormatter()

  return {
    tick: (start: string) => format.dateTime(new Date(start), tickFormats[window]),
    range: ({ start, end }: Pick<BucketRow, 'start' | 'end'>) =>
      format.dateTimeRange(new Date(start), new Date(end), rangeFormats[window]),
    count: (value: number) => format.number(value),
    compact: (value: number) => format.number(value, { notation: 'compact' }),
    percent: (value: number) =>
      format.number(value, { style: 'percent', maximumFractionDigits: 1 }),
  }
}

function Swatch({ series }: { series: 'delivered' | 'failed' }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[2px]"
      style={{ background: series === 'delivered' ? deliveredColor : failedHatch }}
    />
  )
}

function BucketTooltip({
  active,
  activeIndex,
  rows,
  window,
}: Partial<TooltipContentProps> & { rows: BucketRow[]; window: OverviewWindow }) {
  const t = useTranslations('Overview')
  const formats = useFormats(window)
  const row = activeIndex === undefined ? undefined : rows[Number(activeIndex)]

  if (!active || !row) {
    return null
  }

  return (
    <div className="bg-background border-border/50 grid min-w-40 gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{formats.range(row)}</p>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        <Swatch series="failed" />
        <dt className="text-muted-foreground">{t('series.failed')}</dt>
        <dd className="text-right font-mono tabular-nums">{formats.count(row.failed)}</dd>
        <Swatch series="delivered" />
        <dt className="text-muted-foreground">{t('series.delivered')}</dt>
        <dd className="text-right font-mono tabular-nums">{formats.count(row.delivered)}</dd>
        <span aria-hidden />
        <dt className="text-muted-foreground">{t('series.errorRate')}</dt>
        <dd className="text-right font-mono tabular-nums">
          {row.errorRate === null ? t('table.noErrorRate') : formats.percent(row.errorRate)}
        </dd>
      </dl>
    </div>
  )
}

function ChartCard({
  title,
  description,
  summary,
  legend,
  children,
}: {
  title: string
  description: string
  summary: string
  legend?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const summaryId = useId()

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <figure
          aria-describedby={summaryId}
          aria-labelledby={titleId}
          className="flex flex-col gap-3">
          {legend}
          {children}
          <figcaption id={summaryId} className="sr-only">
            {summary}
          </figcaption>
        </figure>
      </CardContent>
    </Card>
  )
}

const axisProps = { tickLine: false, axisLine: false, tickMargin: 8 } as const

export function ThroughputChart({ rows, window }: { rows: BucketRow[]; window: OverviewWindow }) {
  const t = useTranslations('Overview')
  const formats = useFormats(window)
  const hatchId = `failed-hatch-${useId().replaceAll(/[^\w-]/g, '')}`
  const totals = totalsOf(rows)
  const peak = peakOf(rows, (row) => row.delivered + row.failed)

  return (
    <ChartCard
      description={t('throughput.description', { bucket: t(`bucket.${window}`) })}
      legend={
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {(['delivered', 'failed'] as const).map((series) => (
            <li key={series} className="flex items-center gap-1.5">
              <Swatch series={series} />
              {t(`series.${series}`)}
            </li>
          ))}
        </ul>
      }
      summary={t('throughput.summary', {
        delivered: totals.delivered,
        failed: totals.failed,
        period: t(`period.${window}`),
        peakTime: peak ? formats.range(peak) : '',
        peak: peak ? peak.delivered + peak.failed : 0,
      })}
      title={t('throughput.title')}>
      <ChartContainer config={chartConfig} className={chartClassName}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <pattern
              id={hatchId}
              height="4"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
              width="4">
              <rect fill={failedColor} height="4" width="4" />
              <line stroke={failedInk} strokeWidth="1.5" x1="0" x2="0" y1="0" y2="4" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="start" minTickGap={24} tickFormatter={formats.tick} {...axisProps} />
          <YAxis allowDecimals={false} tickFormatter={formats.compact} width={40} {...axisProps} />
          <ChartTooltip content={<BucketTooltip rows={rows} window={window} />} />
          <Bar
            dataKey="delivered"
            fill={deliveredColor}
            isAnimationActive={false}
            maxBarSize={24}
            stackId="runs"
            stroke="var(--card)"
            strokeWidth={1}
          />
          <Bar
            dataKey="failed"
            fill={`url(#${hatchId})`}
            isAnimationActive={false}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            stackId="runs"
            stroke="var(--card)"
            strokeWidth={1}
          />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

function rateDot(
  { cx, cy, index }: DotItemDotProps,
  rows: BucketRow[],
  lastIndex: number,
  percent: (value: number) => string,
) {
  const rate = rows[index]?.errorRate

  const isolated = rows[index - 1]?.errorRate == null && rows[index + 1]?.errorRate == null

  if (cx === undefined || cy === undefined || rate == null || (index !== lastIndex && !isolated)) {
    return <g key={index} />
  }

  return (
    <g key={index}>
      <circle cx={cx} cy={cy} fill={failedColor} r={4} stroke="var(--card)" strokeWidth={2} />
      {index === lastIndex && (
        <text dominantBaseline="middle" x={cx + 8} y={cy} className="fill-foreground text-xs">
          {percent(rate)}
        </text>
      )}
    </g>
  )
}

export function ErrorRateChart({ rows, window }: { rows: BucketRow[]; window: OverviewWindow }) {
  const t = useTranslations('Overview')
  const formats = useFormats(window)
  const totals = totalsOf(rows)
  const peak = peakOf(rows, (row) => row.errorRate)
  const lastIndex = rows.findLastIndex((row) => row.errorRate !== null)
  const ticks = rateTicks(rows)

  return (
    <ChartCard
      description={t('errorRate.description', { bucket: t(`bucket.${window}`) })}
      summary={t('errorRate.summary', {
        period: t(`period.${window}`),
        rate: totals.errorRate === null ? t('kpis.noErrorRate') : formats.percent(totals.errorRate),
        peakTime: peak ? formats.range(peak) : '',
        peakRate: peak?.errorRate == null ? '' : formats.percent(peak.errorRate),
      })}
      title={t('errorRate.title')}>
      <ChartContainer config={chartConfig} className={chartClassName}>
        <LineChart data={rows} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="start" minTickGap={24} tickFormatter={formats.tick} {...axisProps} />
          <YAxis
            domain={[0, ticks.at(-1) ?? 1]}
            tickFormatter={formats.percent}
            ticks={ticks}
            width={44}
            {...axisProps}
          />
          <ChartTooltip content={<BucketTooltip rows={rows} window={window} />} />
          <Line
            activeDot={{ r: 5, fill: failedColor, stroke: 'var(--card)', strokeWidth: 2 }}
            dataKey="errorRate"
            dot={(props) => rateDot(props, rows, lastIndex, formats.percent)}
            isAnimationActive={false}
            stroke={failedColor}
            strokeWidth={2}
            type="linear"
          />
        </LineChart>
      </ChartContainer>
    </ChartCard>
  )
}

export function BucketTable({ rows, window }: { rows: BucketRow[]; window: OverviewWindow }) {
  const t = useTranslations('Overview')
  const formats = useFormats(window)

  return (
    <details className="group rounded-xl border">
      <summary className="hover:bg-muted/50 focus-visible:ring-ring/50 cursor-pointer rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-[3px]">
        {t('table.toggle')}
      </summary>
      <Table>
        <TableCaption className="sr-only">
          {t('table.caption', { bucket: t(`bucket.${window}`) })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('table.columns.period')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('table.columns.delivered')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('table.columns.failed')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('table.columns.errorRate')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.start}>
              <TableCell>{formats.range(row)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formats.count(row.delivered)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formats.count(row.failed)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.errorRate === null ? t('table.noErrorRate') : formats.percent(row.errorRate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  )
}
