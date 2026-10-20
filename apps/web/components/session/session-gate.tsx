'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useSyncExternalStore } from 'react'

import { useSession } from '@/hooks/use-session'

export function SessionGate({ children }: { children: ReactNode }) {
  const t = useTranslations('Shell.session')
  const router = useRouter()
  const { isPending, signedOut } = useSession()

  useEffect(() => {
    if (signedOut) {
      router.replace('/login')
    }
  }, [router, signedOut])

  const serverOrHydrating = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  )

  if (isPending || signedOut) {
    return (
      <>
        <div aria-busy>
          <p role="status" className="text-muted-foreground p-6 text-sm">
            {t(signedOut ? 'redirecting' : 'loading')}
          </p>
        </div>
        {/* The server render needs the page, so that its notFound() answers 404. */}
        {serverOrHydrating && <div hidden>{children}</div>}
      </>
    )
  }

  return children
}

function subscribeToNothing() {
  return () => {}
}
