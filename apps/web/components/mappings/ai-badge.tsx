'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@edi-bridge/ui/lib/utils'

export function AiBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'border-ai-proposed text-ai-proposed inline-flex shrink-0 items-center rounded-sm border border-dashed px-1.5 py-0.5 font-sans text-xs font-semibold',
        className,
      )}
      data-ai-proposed>
      {label}
    </span>
  )
}

export function AiMarker({ label, className }: { label: string; className?: string }) {
  const t = useTranslations('Mapping.aiReview')

  return (
    <>
      <span
        aria-hidden
        className={cn(
          'border-ai-proposed text-ai-proposed inline-flex h-4 shrink-0 items-center rounded-sm border border-dashed px-1 font-sans text-[10px] leading-none font-semibold',
          className,
        )}
        data-ai-proposed>
        {t('marker')}
      </span>
      <span className="sr-only">{` ${label}`}</span>
    </>
  )
}
