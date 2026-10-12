'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode, Ref } from 'react'

import { useBreadcrumbName } from '@/hooks/use-breadcrumb-name'
import { useCanChange } from '@/hooks/use-session'
import { cn } from '@edi-bridge/ui/lib/utils'

export function AppPage({
  title,
  name,
  meta,
  actions,
  changeActions,
  busy,
  titleRef,
  className,
  children,
}: {
  title?: string | undefined
  name?: string | undefined
  meta?: ReactNode
  actions?: ReactNode
  changeActions?: ReactNode
  busy?: boolean
  titleRef?: Ref<HTMLHeadingElement> | undefined
  className?: string
  children: ReactNode
}) {
  const t = useTranslations('Breadcrumb')
  const canChange = useCanChange()
  const shownChangeActions = canChange && changeActions

  useBreadcrumbName(name)

  return (
    <div
      aria-busy={busy || undefined}
      className={cn('flex min-w-0 flex-1 flex-col gap-6 p-6', className)}>
      <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="sr-only">
        {title ?? name ?? t('details')}
      </h1>
      {(meta || actions || shownChangeActions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {meta && (
            <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-2 text-sm">
              {meta}
            </div>
          )}
          {(actions || shownChangeActions) && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {actions}
              {shownChangeActions}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
