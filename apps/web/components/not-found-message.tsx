'use client'

import { useTranslations } from 'next-intl'

import { Empty, EmptyDescription, EmptyHeader } from '@edi-bridge/ui/components/empty'

export function NotFoundMessage() {
  const t = useTranslations('NotFound')

  return (
    <div className="flex flex-1 flex-col p-6">
      <Empty>
        <EmptyHeader>
          <h1 className="text-lg font-medium tracking-tight">{t('title')}</h1>
          <EmptyDescription>{t('description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
