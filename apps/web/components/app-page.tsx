'use client'

import type { ReactNode, Ref } from 'react'

import { useBreadcrumbName } from '@/hooks/use-breadcrumb-name'
import { cn } from '@edi-bridge/ui/lib/utils'

export function AppPage({
  title,
  name,
  meta,
  actions,
  busy,
  titleRef,
  className,
  children,
}: {
  title: string
  name?: string | undefined
  meta?: ReactNode
  actions?: ReactNode
  busy?: boolean
  titleRef?: Ref<HTMLHeadingElement>
  className?: string
  children: ReactNode
}) {
  useBreadcrumbName(name)

  return (
    <div
      aria-busy={busy || undefined}
      className={cn('flex min-w-0 flex-1 flex-col gap-4 p-6', className)}>
      <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="sr-only">
        {title}
      </h1>
      {(meta || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {meta}
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </div>
  )
}
