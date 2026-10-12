'use client'

import { ArrowRight01Icon, Rocket01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { LinkCard } from '@/components/home/link-card'
import { navigationItems } from '@/lib/navigation'
import { Progress } from '@edi-bridge/ui/components/progress'

export function HomeSetupLink({ done, total }: { done: number; total: number }) {
  const t = useTranslations('Home.setup')

  return (
    <LinkCard
      href={navigationItems.firstSteps.href}
      className="flex-row items-center gap-3 px-4 py-3">
      <HugeiconsIcon
        icon={Rocket01Icon}
        strokeWidth={2}
        aria-hidden
        className="text-primary size-5 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-sm font-medium">{t('title')}</span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {t('progress', { done, total })}
        </span>
        <Progress value={(done / total) * 100} aria-hidden className="sm:ml-auto sm:w-40" />
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
    </LinkCard>
  )
}
