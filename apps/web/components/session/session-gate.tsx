'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useSession } from '@/hooks/use-session'
import { isUnauthorized } from '@/lib/api/client'

export function SessionGate({ children }: { children: ReactNode }) {
  const t = useTranslations('Shell.session')
  const router = useRouter()
  const { error } = useSession()
  const signedOut = isUnauthorized(error)

  useEffect(() => {
    if (signedOut) {
      router.replace('/login')
    }
  }, [router, signedOut])

  if (signedOut) {
    return (
      <p role="status" className="text-muted-foreground p-6 text-sm">
        {t('redirecting')}
      </p>
    )
  }

  return children
}
