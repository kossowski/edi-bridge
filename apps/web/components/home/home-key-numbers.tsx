'use client'

import { Alert02Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import { useId } from 'react'

import { LinkCard } from '@/components/home/link-card'
import { navigationItems } from '@/lib/navigation'
import { taskGroupHref } from '@/lib/task-href'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { StatusGroup } from '@/lib/status-groups'
import type { HomeKeyNumbers as KeyNumbers, HomeWindow } from '@edi-bridge/contracts'

const documentsHref = (status: StatusGroup) =>
  `${navigationItems.documents.href}?${new URLSearchParams({ status })}`

function KeyNumberCard({
  href,
  label,
  value,
  hint,
  alert = false,
}: {
  href: string
  label: string
  value: number | undefined
  hint: string | undefined
  alert?: boolean
}) {
  const t = useTranslations('Home.keyNumbers')
  const format = useFormatter()

  return (
    <li className="flex min-w-0">
      <LinkCard href={href} className="min-w-0 flex-1 gap-1 p-4">
        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-muted-foreground text-sm">{label}</span>
          {alert && (
            <span className="text-destructive flex items-center gap-1 text-xs font-medium">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
              {t('alert')}
            </span>
          )}
        </span>
        {value === undefined ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span
            className={cn(
              'text-2xl font-semibold tracking-tight tabular-nums',
              alert && 'text-destructive',
            )}>
            {format.number(value)}
          </span>
        )}
        {hint === undefined ? (
          <Skeleton className="mt-auto h-4 w-24" />
        ) : (
          <span className="text-muted-foreground mt-auto flex items-center gap-1 text-xs">
            {hint}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              aria-hidden
              className="size-3 shrink-0"
            />
          </span>
        )}
      </LinkCard>
    </li>
  )
}

export function HomeKeyNumbers({
  keyNumbers,
  failed,
  timeWindow,
}: {
  keyNumbers: KeyNumbers | undefined
  failed: number | undefined
  timeWindow: HomeWindow
}) {
  const t = useTranslations('Home.keyNumbers')
  const headingId = useId()
  const needsAttention = keyNumbers?.needsAttention
  const waiting = keyNumbers?.waitingForTradingPartner

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        {t('label')}
      </h2>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumberCard
          alert={needsAttention !== undefined && needsAttention > 0}
          hint={
            needsAttention === undefined
              ? undefined
              : t('needsAttention.hint', { count: needsAttention })
          }
          href={taskGroupHref('you')}
          label={t('needsAttention.label')}
          value={needsAttention}
        />
        <KeyNumberCard
          hint={failed === undefined ? undefined : t('delivered.hint', { failed })}
          href={documentsHref('done')}
          label={t('delivered.label', { window: timeWindow })}
          value={keyNumbers?.delivered}
        />
        <KeyNumberCard
          hint={keyNumbers ? t('inProgress.hint') : undefined}
          href={documentsHref('progress')}
          label={t('inProgress.label')}
          value={keyNumbers?.inProgress}
        />
        <KeyNumberCard
          hint={
            waiting === undefined
              ? undefined
              : t('waitingForTradingPartner.hint', { count: waiting })
          }
          href={taskGroupHref('tradingPartner')}
          label={t('waitingForTradingPartner.label')}
          value={waiting}
        />
      </ul>
    </section>
  )
}
