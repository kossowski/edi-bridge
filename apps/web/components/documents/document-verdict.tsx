'use client'

import { CheckmarkCircle02Icon, Copy01Icon, HourglassIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { linkClass } from '@/components/detail-parts'
import { usePlainNames } from '@/components/plain-names'
import { documentHref } from '@/lib/navigation'
import { Card, CardContent } from '@edi-bridge/ui/components/card'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunDetail } from '@edi-bridge/contracts'

export type SettledRun = Exclude<RunDetail, { status: 'failed' }>

function Verdict({
  icon,
  iconClassName,
  title,
  description,
  className,
  children,
}: {
  icon: IconSvgElement
  iconClassName: string
  title: string
  description: string
  className?: string
  children?: ReactNode
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-start gap-3">
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          aria-hidden
          className={cn('size-6 shrink-0', iconClassName)}
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h2 className="font-medium">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
          {children}
        </div>
      </CardContent>
    </Card>
  )
}

export function DocumentVerdict({ run }: { run: SettledRun }) {
  const t = useTranslations('Document.verdict')
  const plainNames = usePlainNames()
  const reference = run.businessReference

  const values = {
    direction: run.direction,
    tradingPartner: run.tradingPartner.name,
    messageType: run.messageType,
    messageTypeName: plainNames.messageTypeNameInText(run.messageType),
  }

  switch (run.status) {
    case 'delivered': {
      return (
        <Verdict
          description={t('delivered.description', values)}
          icon={CheckmarkCircle02Icon}
          iconClassName="text-emerald-700 dark:text-emerald-300"
          title={t('delivered.title')}
          className="bg-emerald-500/5 ring-emerald-500/30"
        />
      )
    }

    case 'received':
    case 'processing': {
      return (
        <Verdict
          description={t('inProgress.description')}
          icon={HourglassIcon}
          iconClassName="text-muted-foreground"
          title={t('inProgress.title')}
        />
      )
    }

    case 'duplicate': {
      return (
        <Verdict
          description={
            reference === null
              ? t('duplicate.descriptionWithoutReference', values)
              : t('duplicate.description', { ...values, reference })
          }
          icon={Copy01Icon}
          iconClassName="text-muted-foreground"
          title={t('duplicate.title', values)}>
          {run.duplicateOf && (
            <Link href={documentHref(run.duplicateOf.id)} className={cn(linkClass, 'text-sm')}>
              {t('duplicate.original')}
            </Link>
          )}
        </Verdict>
      )
    }
  }
}
