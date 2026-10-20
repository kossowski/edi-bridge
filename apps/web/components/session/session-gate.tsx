'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useClientValue } from '@/hooks/use-client-value'
import { useSession } from '@/hooks/use-session'

export function SessionGate({ children }: { children: ReactNode }) {
  const t = useTranslations('Shell.session')
  const router = useRouter()
  const { isPending, signedOut } = useSession()
  const hydrated = useClientValue(() => true, false)

  useEffect(() => {
    if (signedOut) {
      router.replace('/login')
    }
  }, [router, signedOut])

  if (isPending || signedOut) {
    return (
      <>
        <div aria-busy>
          <p role="status" className="text-muted-foreground p-6 text-sm">
            {t(signedOut ? 'redirecting' : 'loading')}
          </p>
        </div>
        {!hydrated && <ServerRenderedPage>{children}</ServerRenderedPage>}
      </>
    )
  }

  return children
}

// The server render lets notFound() answer 404; the client leaves it unhydrated, so no effects run.
function ServerRenderedPage({ children }: { children: ReactNode }) {
  if (typeof window === 'undefined') {
    return <div hidden>{children}</div>
  }

  return <div dangerouslySetInnerHTML={{ __html: '' }} hidden suppressHydrationWarning />
}
