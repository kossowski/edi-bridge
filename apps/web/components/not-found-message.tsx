'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@edi-bridge/ui/components/empty'

export function NotFoundMessage({
  title,
  description,
  children,
}: {
  title?: string
  description?: string
  children?: ReactNode
}) {
  const t = useTranslations('NotFound')

  return (
    <div className="flex flex-1 flex-col p-6">
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-medium tracking-tight">{title ?? t('title')}</h1>
          <EmptyDescription>{description ?? t('description')}</EmptyDescription>
        </EmptyHeader>
        {children && <EmptyContent>{children}</EmptyContent>}
      </Empty>
    </div>
  )
}
