'use client'

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DashedLineCircleIcon,
  HourglassIcon,
  Route01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

import { cn } from '@edi-bridge/ui/lib/utils'

import type { OrderLifecycleStatus, OrderLifecycleStepState } from '@edi-bridge/contracts'

export type StepState = OrderLifecycleStepState | 'missing'

const statusIcons: Record<OrderLifecycleStatus, IconSvgElement> = {
  'on-track': Route01Icon,
  'needs-attention': Alert02Icon,
  'waiting-for-trading-partner': Clock01Icon,
  done: CheckmarkCircle02Icon,
}

const stepStateIcons: Record<StepState, IconSvgElement> = {
  open: DashedLineCircleIcon,
  missing: DashedLineCircleIcon,
  'in-progress': HourglassIcon,
  'needs-attention': Alert02Icon,
  'waiting-for-trading-partner': Clock01Icon,
  done: CheckmarkCircle02Icon,
}

export function OrderStatusIcon({
  status,
  className,
}: {
  status: OrderLifecycleStatus
  className?: string
}) {
  return (
    <HugeiconsIcon
      icon={statusIcons[status]}
      strokeWidth={2}
      aria-hidden
      className={cn(
        'text-muted-foreground data-[status=done]:text-success-text data-[status=needs-attention]:text-destructive-text shrink-0 data-[status=waiting-for-trading-partner]:text-amber-700 dark:data-[status=waiting-for-trading-partner]:text-amber-300',
        className,
      )}
      data-status={status}
    />
  )
}

export function StepIcon({
  state,
  size = 'default',
}: {
  state: StepState
  size?: 'default' | 'sm'
}) {
  return (
    <span
      className="bg-background data-[state=done]:border-success-text/40 data-[state=needs-attention]:border-destructive/40 data-[state=needs-attention]:bg-destructive/10 data-[state=in-progress]:border-info/40 data-[state=missing]:bg-muted/40 data-[state=open]:bg-muted/40 relative flex size-8 shrink-0 items-center justify-center rounded-full border data-[size=sm]:size-6 data-[state=done]:bg-emerald-500/10 data-[state=in-progress]:bg-sky-500/10 data-[state=missing]:border-dashed data-[state=open]:border-dashed data-[state=waiting-for-trading-partner]:border-amber-500/40 data-[state=waiting-for-trading-partner]:bg-amber-500/10"
      data-size={size}
      data-state={state}>
      <HugeiconsIcon
        icon={stepStateIcons[state]}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground data-[state=done]:text-success-text data-[state=in-progress]:text-info data-[state=needs-attention]:text-destructive-text size-4 data-[size=sm]:size-3.5 data-[state=waiting-for-trading-partner]:text-amber-700 dark:data-[state=waiting-for-trading-partner]:text-amber-300"
        data-size={size}
        data-state={state}
      />
    </span>
  )
}
