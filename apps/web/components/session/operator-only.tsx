'use client'

import { useTranslations } from 'next-intl'

import type { ReactNode } from 'react'

import { NotFoundMessage } from '@/components/not-found-message'
import { useSession } from '@/hooks/use-session'

export function OperatorOnly({ children }: { children: ReactNode }) {
  const t = useTranslations('Shell.session')
  const { session, isPending, operator } = useSession()

  if (isPending) {
    return (
      <p role="status" className="sr-only">
        {t('checkingAccess')}
      </p>
    )
  }

  return session && operator ? children : <NotFoundMessage />
}
