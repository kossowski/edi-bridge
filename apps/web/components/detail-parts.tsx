'use client'

import { AlertCircleIcon, ArrowLeft01Icon, FileNotFoundIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'

export const linkClass =
  'focus-visible:ring-ring/50 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3'

export function BackToRuns({ label }: { label: string }) {
  return <BackLink href="/runs" label={label} />
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex w-fit items-center gap-1 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3">
      <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden className="size-4" />
      {label}
    </Link>
  )
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function LoadFailure({
  notFound,
  namespace,
  onRetry,
}: {
  notFound: boolean
  namespace:
    'RunDetail' | 'Interchange' | 'TradingPartner' | 'Channel' | 'Flow' | 'Mapping' | 'Settings'
  onRetry: () => void
}) {
  const t = useTranslations(namespace)

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={notFound ? FileNotFoundIcon : AlertCircleIcon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{notFound ? t('notFound.title') : t('error.title')}</EmptyTitle>
        <EmptyDescription>
          {notFound ? t('notFound.description') : t('error.description')}
        </EmptyDescription>
      </EmptyHeader>
      {!notFound && (
        <EmptyContent>
          <Button variant="outline" onClick={onRetry}>
            {t('error.retry')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}
