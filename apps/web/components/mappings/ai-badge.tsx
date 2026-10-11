'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@edi-bridge/ui/lib/utils'

// The short marker fits a canvas row; the label is what a screen reader hears, or what a list shows.
export function AiBadge({
  label,
  short = false,
  className,
}: {
  label: string
  short?: boolean
  className?: string
}) {
  const t = useTranslations('Mapping.aiReview')

  return (
    <span
      className={cn(
        'border-ai-proposed text-ai-proposed inline-flex shrink-0 items-center rounded-sm border border-dashed font-sans font-semibold',
        short ? 'h-4 px-1 text-[10px] leading-none' : 'px-1.5 py-0.5 text-xs',
        className,
      )}
      data-ai-proposed>
      {short ? (
        <>
          <span aria-hidden>{t('marker')}</span>
          <span className="sr-only">{` ${label}`}</span>
        </>
      ) : (
        label
      )}
    </span>
  )
}
