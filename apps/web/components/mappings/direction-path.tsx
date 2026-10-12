'use client'

import { ArrowRight02Icon, DatabaseIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { cn } from '@edi-bridge/ui/lib/utils'

import type { Direction } from '@edi-bridge/contracts'

export function DirectionPath({
  direction,
  partner,
  erp,
  className,
}: {
  direction: Direction
  partner: ReactNode
  erp: ReactNode
  className?: string
}) {
  const t = useTranslations('Mappings.path')

  const erpEnd = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
        <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} aria-hidden className="size-3.5" />
      </span>
      {erp}
    </span>
  )

  return (
    <p className={cn('items-center gap-2', className)}>
      {direction === 'inbound' ? partner : erpEnd}
      <span className="text-muted-foreground flex">
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} aria-hidden className="size-4" />
        <span className="sr-only"> {t(direction)} </span>
      </span>
      {direction === 'inbound' ? erpEnd : partner}
    </p>
  )
}
