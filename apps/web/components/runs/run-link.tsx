'use client'

import { useFormatter } from 'next-intl'
import Link from 'next/link'

import type { ComponentProps } from 'react'

import type { RunSummary } from '@edi-bridge/contracts'

export function RunLink({
  run,
  description,
  ...props
}: { run: RunSummary; description: string } & Omit<
  ComponentProps<typeof Link>,
  'href' | 'className' | 'children'
>) {
  const format = useFormatter()

  return (
    <Link
      href={`/runs/${run.id}`}
      className="focus-visible:after:ring-ring font-medium tabular-nums underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset"
      {...props}>
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
