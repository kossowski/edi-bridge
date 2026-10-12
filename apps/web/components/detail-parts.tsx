'use client'

import { AlertCircleIcon, FileNotFoundIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

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
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

export const linkClass =
  'focus-visible:ring-ring/50 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3'

export const rowLinkClass =
  'focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset'

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function FactGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
      {children}
    </dl>
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

export function Loading({
  label,
  rows = 6,
  rowClassName = 'h-8',
}: {
  label: string
  rows?: number
  rowClassName?: string
}) {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        {label}
      </p>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className={cn('w-full', rowClassName)} />
      ))}
    </div>
  )
}

export function Notice({
  icon,
  title,
  description,
  children,
}: {
  icon: IconSvgElement
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

export function Failure({
  notFound,
  error,
  onRetry,
}: {
  notFound: { title: string; description: string; action?: ReactNode } | null
  error: { title: string; description: string; retry: string }
  onRetry: () => void
}) {
  if (notFound) {
    return (
      <Notice description={notFound.description} icon={FileNotFoundIcon} title={notFound.title}>
        {notFound.action}
      </Notice>
    )
  }

  return (
    <Notice description={error.description} icon={AlertCircleIcon} title={error.title}>
      <Button variant="outline" onClick={onRetry}>
        {error.retry}
      </Button>
    </Notice>
  )
}

export function LoadFailure({
  notFound,
  notFoundAction,
  namespace,
  onRetry,
}: {
  notFound: boolean
  notFoundAction?: ReactNode
  namespace:
    | 'Document'
    | 'TradingPartner'
    | 'Channel'
    | 'Flow'
    | 'CodeTranslation'
    | 'Mapping'
    | 'Mapping.canvas'
    | 'DocumentStructure'
    | 'Settings'
  onRetry: () => void
}) {
  const t = useTranslations(namespace)

  return (
    <Failure
      error={{
        title: t('error.title'),
        description: t('error.description'),
        retry: t('error.retry'),
      }}
      notFound={
        notFound
          ? {
              title: t('notFound.title'),
              description: t('notFound.description'),
              action: notFoundAction,
            }
          : null
      }
      onRetry={onRetry}
    />
  )
}
