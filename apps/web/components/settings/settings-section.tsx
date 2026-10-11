'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'

import { LoadFailure } from '@/components/detail-parts'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function SettingsSection({
  title,
  description,
  status,
  onRetry,
  children,
}: {
  title: string
  description: string
  status: 'pending' | 'error' | 'success'
  onRetry: () => void
  children: ReactNode
}) {
  const t = useTranslations('Settings')
  const id = useId()

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {status === 'pending' && (
        <div aria-busy className="flex max-w-xl flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {status === 'error' && (
        <LoadFailure namespace="Settings" notFound={false} onRetry={onRetry} />
      )}
      {status === 'success' && children}
    </section>
  )
}
