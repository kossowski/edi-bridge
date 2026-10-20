'use client'

import { useTranslations } from 'next-intl'
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
  type HomeSeries,
  peakOf,
  rateTicks,
  timeTicks,
} from '@/components/home/home-data'
import { useFormats } from '@/components/home/home-formats'
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
import { cn } from '@edi-bridge/ui/lib/utils'

const chartConfig = {
  delivered: { color: 'var(--chart-1)' },
  failed: { color: 'var(--chart-2)' },
  errorRate: { color: 'var(--chart-2)' },
} satisfies ChartConfig

const series = ['delivered', 'failed'] as const

function Swatch({ series }: { series: 'delivered' | 'failed' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-[2px]',
        series === 'delivered'
          ? 'bg-chart-1'
          : 'bg-[repeating-linear-gradient(-45deg,var(--chart-2-hatch)_0_1.5px,var(--chart-2)_1.5px_4px)]',
      )}
    />
  )
}

function BucketTooltip({
  active,
  activeIndex,
  rows,
  timeWindow,
}: Partial<TooltipContentProps> & Pick<HomeSeries, 'rows' | 'timeWindow'>) {
  const t = useTranslations('Home')
  const formats = useFormats(timeWindow)
  const row = activeIndex === undefined ? undefined : rows[Number(activeIndex)]

  if (!active || !row) {
    return null
  }

  return (
    <div className="bg-background border-border/50 grid min-w-40 gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">
        {formats.range(row)}
        {row.inProgress && (
          <span className="text-muted-foreground block font-normal">{t('inProgress')}</span>
        )}
      </p>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        <Swatch series="delivered" />
        <dt className="text-muted-foreground">{t('series.delivered')}</dt>
        <dd className="text-right font-mono tabular-nums">{formats.count(row.delivered)}</dd>
        <Swatch series="failed" />
        <dt className="text-muted-foreground">{t('series.failed')}</dt>
        <dd className="text-right font-mono tabular-nums">{formats.count(row.failed)}</dd>
        <span aria-hidden />
        <dt className="text-muted-foreground">{t('series.errorRate')}</dt>
        <dd className="text-right font-mono tabular-nums">{formats.errorRate(row.errorRate)}</dd>
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

function toBarRows(rows: ReadonlyArray<BucketRow>) {
  return rows.map(({ start, delivered, failed, inProgress }) => ({
    start,
    delivered: inProgress ? null : delivered,
    failed: inProgress ? null : failed,
    deliveredInProgress: inProgress ? delivered : null,
    failedInProgress: inProgress ? failed : null,
  }))
}

const inProgressBarProps = { fillOpacity: 0.35, strokeDasharray: '3 2' } as const

const barProps = {
  isAnimationActive: false,
  maxBarSize: 24,
  stackId: 'runs',
  stroke: 'var(--card)',
  strokeWidth: 1,
} as const

export function ThroughputChart({ rows, totals, timeWindow }: HomeSeries) {
  const t = useTranslations('Home')
  const formats = useFormats(timeWindow)
  const hatchId = `failed-hatch-${useId().replaceAll(/[^\w-]/g, '')}`
  const peak = peakOf(rows, (row) => row.delivered + row.failed)
  const title = t('throughput.title')

  return (
    <ChartCard
      description={t('throughput.description', { bucket: t(`bucket.${timeWindow}`) })}
      legend={
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <Swatch series={key} />
              {t(`series.${key}`)}
            </li>
          ))}
        </ul>
      }
      summary={t('throughput.summary', {
        delivered: totals.delivered,
        failed: totals.failed,
        period: t(`period.${timeWindow}`),
        peakTime: peak ? formats.range(peak) : '',
        peak: peak ? peak.delivered + peak.failed : 0,
      })}
      title={title}>
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <BarChart
          data={toBarRows(rows)}
          // Room for half the latest bucket's label, which centres on the chart's last bar.
          margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
          aria-label={title}>
          <defs>
            <pattern
              id={hatchId}
              height="4"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
              width="4">
              <rect fill="var(--color-failed)" height="4" width="4" />
              <line stroke="var(--chart-2-hatch)" strokeWidth="1.5" x1="0" x2="0" y1="0" y2="4" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            interval={0}
            tickFormatter={formats.tick}
            ticks={timeTicks(rows, timeWindow)}
            {...axisProps}
          />
          <YAxis allowDecimals={false} tickFormatter={formats.compact} width={40} {...axisProps} />
          <ChartTooltip content={<BucketTooltip rows={rows} timeWindow={timeWindow} />} />
          <Bar {...barProps} dataKey="delivered" fill="var(--color-delivered)" />
          <Bar {...barProps} dataKey="failed" fill={`url(#${hatchId})`} radius={[4, 4, 0, 0]} />
          <Bar
            {...barProps}
            {...inProgressBarProps}
            dataKey="deliveredInProgress"
            fill="var(--color-delivered)"
            stroke="var(--color-delivered)"
          />
          <Bar
            {...barProps}
            {...inProgressBarProps}
            dataKey="failedInProgress"
            fill={`url(#${hatchId})`}
            radius={[4, 4, 0, 0]}
            stroke="var(--color-failed)"
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
      <circle
        cx={cx}
        cy={cy}
        fill="var(--color-errorRate)"
        r={4}
        stroke="var(--card)"
        strokeWidth={2}
      />
      {index === lastIndex && (
        <text dominantBaseline="middle" x={cx + 8} y={cy} className="fill-foreground text-xs">
          {percent(rate)}
        </text>
      )}
    </g>
  )
}

export function ErrorRateChart({ rows, totals, timeWindow }: HomeSeries) {
  const t = useTranslations('Home')
  const formats = useFormats(timeWindow)
  const lineRows = rows.map((row) => (row.inProgress ? { ...row, errorRate: null } : row))
  const peak = peakOf(lineRows, (row) => row.errorRate)
  const lastIndex = lineRows.findLastIndex((row) => row.errorRate !== null)
  const ticks = rateTicks(lineRows)
  const title = t('errorRate.title')

  return (
    <ChartCard
      description={t('errorRate.description', { bucket: t(`bucket.${timeWindow}`) })}
      summary={t('errorRate.summary', {
        period: t(`period.${timeWindow}`),
        rate: formats.errorRate(totals.errorRate),
        peakTime: peak ? formats.range(peak) : '',
        peakRate: peak?.errorRate == null ? '' : formats.percent(peak.errorRate),
      })}
      title={title}>
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <LineChart
          data={lineRows}
          margin={{ top: 8, right: 48, bottom: 0, left: 0 }}
          aria-label={title}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            interval={0}
            tickFormatter={formats.tick}
            ticks={timeTicks(rows, timeWindow)}
            {...axisProps}
          />
          <YAxis
            domain={[0, ticks.at(-1) ?? 1]}
            tickFormatter={formats.percent}
            ticks={ticks}
            width={44}
            {...axisProps}
          />
          <ChartTooltip content={<BucketTooltip rows={rows} timeWindow={timeWindow} />} />
          <Line
            activeDot={{
              r: 5,
              fill: 'var(--color-errorRate)',
              stroke: 'var(--card)',
              strokeWidth: 2,
            }}
            dataKey="errorRate"
            dot={(props) => rateDot(props, lineRows, lastIndex, formats.percent)}
            isAnimationActive={false}
            stroke="var(--color-errorRate)"
            strokeWidth={2}
            type="linear"
          />
        </LineChart>
      </ChartContainer>
    </ChartCard>
  )
}

export function BucketTable({ rows, timeWindow }: Pick<HomeSeries, 'rows' | 'timeWindow'>) {
  const t = useTranslations('Home')
  const formats = useFormats(timeWindow)

  return (
    <details className="group rounded-xl border">
      <summary className="hover:bg-muted/50 focus-visible:ring-ring/50 cursor-pointer rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-[3px]">
        {t('table.toggle')}
      </summary>
      <Table className="text-xs sm:text-sm">
        <TableCaption className="sr-only">
          {t('table.caption', { bucket: t(`bucket.${timeWindow}`) })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="px-1.5 whitespace-normal sm:px-2">
              {t('table.columns.period')}
            </TableHead>
            {(['delivered', 'failed', 'errorRate'] as const).map((key) => (
              <TableHead
                key={key}
                scope="col"
                className="px-1.5 text-right whitespace-normal sm:px-2">
                {t(`series.${key}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.start}>
              <TableCell className="px-1.5 whitespace-normal sm:px-2">
                {formats.range(row)}
                {row.inProgress && (
                  <span className="text-muted-foreground block">{t('inProgress')}</span>
                )}
              </TableCell>
              <TableCell className="px-1.5 text-right whitespace-normal tabular-nums sm:px-2">
                {formats.count(row.delivered)}
              </TableCell>
              <TableCell className="px-1.5 text-right whitespace-normal tabular-nums sm:px-2">
                {formats.count(row.failed)}
              </TableCell>
              <TableCell className="px-1.5 text-right whitespace-normal tabular-nums sm:px-2">
                {formats.errorRate(row.errorRate)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  )
}
