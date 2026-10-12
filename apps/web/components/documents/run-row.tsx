'use client'

import { ArrowDownLeft01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { FixerBadge } from '@/components/documents/fixer-badge'
import { RelativeTime } from '@/components/documents/relative-time'
import { RunStatusBadge } from '@/components/documents/run-status'
import { useRunTitle } from '@/components/documents/run-title'
import { usePlainNames } from '@/components/plain-names'
import { documentHref, orderHref } from '@/lib/navigation'
import { whoFixes } from '@edi-bridge/contracts'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@edi-bridge/ui/components/item'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunSummary } from '@edi-bridge/contracts'

export function RunRow({ run }: { run: RunSummary }) {
  const t = useTranslations('Documents.row')
  const plainNames = usePlainNames()
  const title = useRunTitle(run)
  const fixer = whoFixes(run)
  const href = documentHref(run.id)
  const reference = run.businessReference

  return (
    <Item render={<li />} variant="outline" className="items-start">
      <ItemMedia className="bg-muted text-muted-foreground size-8 rounded-full">
        <HugeiconsIcon
          icon={run.direction === 'inbound' ? ArrowDownLeft01Icon : ArrowUpRight01Icon}
          strokeWidth={2}
          aria-hidden
          className="size-4"
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none w-full">
          <Link
            href={href}
            className="focus-visible:ring-ring/50 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-3">
            {title}
          </Link>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {run.tradingPartner.name} · {plainNames.messageTypeName(run.messageType)}
          {reference !== null && (
            <>
              {' · '}
              {t.rich('order', {
                reference,
                link: (chunks) => (
                  <Link
                    href={orderHref(reference)}
                    className="text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-3">
                    {chunks}
                  </Link>
                ),
              })}
            </>
          )}
          {' · '}
          <RelativeTime dateTime={run.receivedAt} />
          {run.manualSubmission && ` · ${t('uploaded')}`}
        </ItemDescription>
        {run.failureStage !== null && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-destructive text-sm font-medium">
              {plainNames.failureStageTitle(run.failureStage)}
            </span>
            {fixer && <FixerBadge fixer={fixer} />}
          </div>
        )}
      </ItemContent>
      <ItemActions className="basis-full flex-wrap pl-10.5 @2xl:ml-auto @2xl:basis-auto @2xl:justify-end @2xl:pl-0">
        <RunStatusBadge status={run.status} />
        {run.status === 'failed' && (
          <Link href={href} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            {t('whatToDo')}
            <span className="sr-only">: {title}</span>
          </Link>
        )}
      </ItemActions>
    </Item>
  )
}

export function RunRowSkeleton() {
  return (
    <Item render={<li />} variant="outline" className="items-start">
      <Skeleton className="size-8 rounded-full" />
      <ItemContent>
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </ItemContent>
      <Skeleton className="h-5 w-20" />
    </Item>
  )
}
