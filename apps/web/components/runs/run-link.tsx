'use client'

import { useFormatter } from 'next-intl'
import Link from 'next/link'

import type { ComponentProps } from 'react'

import { rowLinkClass } from '@/components/detail-parts'
import { runHref } from '@/lib/navigation'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunSummary } from '@edi-bridge/contracts'

export function shortId(id: string) {
  return id.slice(0, 8)
}

export function RunLink({
  run,
  description,
  ...props
}: { run: Pick<RunSummary, 'id' | 'receivedAt'>; description: string } & Omit<
  ComponentProps<typeof Link>,
  'href' | 'className' | 'children'
>) {
  const format = useFormatter()

  return (
    <Link href={runHref(run.id)} className={cn(rowLinkClass, 'tabular-nums')} {...props}>
      <time dateTime={run.receivedAt}>
        {format.dateTime(new Date(run.receivedAt), {
          dateStyle: 'medium',
          timeStyle: 'medium',
        })}
      </time>
      <span className="sr-only"> {description}</span>
    </Link>
  )
}
