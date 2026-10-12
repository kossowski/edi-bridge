'use client'

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  DashedLineCircleIcon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

import type { ReactNode } from 'react'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { MappingState } from '@/components/mappings/mapping-state'

const stateIcons: Record<MappingState, IconSvgElement> = {
  failing: Alert02Icon,
  draft: PencilEdit02Icon,
  new: DashedLineCircleIcon,
  live: CheckmarkCircle02Icon,
}

export function StateBadge({
  state,
  id,
  tabIndex,
  className,
  children,
}: {
  state: MappingState
  id?: string | undefined
  tabIndex?: number | undefined
  className?: string
  children: ReactNode
}) {
  return (
    <Badge
      id={id}
      tabIndex={tabIndex}
      variant="outline"
      className={cn(
        {
          failing: 'bg-red-500/10 text-red-800 dark:text-red-300',
          draft: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
          new: '',
          live: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
        }[state],
        className,
      )}>
      <HugeiconsIcon icon={stateIcons[state]} strokeWidth={2} aria-hidden />
      {children}
    </Badge>
  )
}
