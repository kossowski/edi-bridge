'use client'

import { cn } from 'cn'
import * as React from 'react'
import * as RechartsPrimitive from 'recharts'

const themes = [
  ['light', ''],
  ['dark', '.dark'],
] as const

type Theme = (typeof themes)[number][0]

const INITIAL_DIMENSION = { width: 320, height: 200 } as const

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode } & (
    { color?: string; theme?: never } | { color?: never; theme: Record<Theme, string> }
  )
>

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, item]) => item.theme ?? item.color)

  if (!colorConfig.length) {
    return null
  }

  const css = themes
    .map(([theme, prefix]) => {
      const variables = colorConfig
        .map(([key, item]) => {
          const color = item.theme?.[theme] ?? item.color

          return color ? `  --color-${key}: ${color};` : null
        })
        .join('\n')

      return `${prefix} [data-chart=${id}] {\n${variables}\n}`
    })
    .join('\n')

  return <style dangerouslySetInnerHTML={{ __html: css }} />
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
  initialDimension?: { width: number; height: number }
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id ?? uniqueId.replaceAll(/[^\w-]/g, '')}`

  return (
    <div
      className={cn(
        "[&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-surface:focus-visible]:outline-ring flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:rounded-sm [&_.recharts-surface]:outline-hidden [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-solid",
        className,
      )}
      data-chart={chartId}
      data-slot="chart"
      {...props}>
      <ChartStyle id={chartId} config={config} />
      <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

export { ChartContainer, ChartTooltip }
