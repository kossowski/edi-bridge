'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

export function WizardLoading({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-muted-foreground text-sm">
        {message}
      </p>
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  )
}

export function WizardLoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('PartnerWizard')

  return (
    <div
      role="alert"
      className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-sm">
      <p>{message}</p>
      <Button size="sm" type="button" variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  )
}
