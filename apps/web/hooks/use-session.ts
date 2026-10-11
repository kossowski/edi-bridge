'use client'

import { useQuery } from '@tanstack/react-query'

import { isUnauthorized } from '@/lib/api/client'
import { sessionQuery } from '@/lib/api/queries'
import { canChange } from '@/lib/session'

export function useSession() {
  const { data, error, isPending } = useQuery(sessionQuery)
  const session = data ?? null
  const signedOut = isUnauthorized(error)

  return {
    session,
    error,
    isPending,
    signedOut,
    unavailable: error !== null && !signedOut,
    role: session?.role ?? null,
    operator: session?.operator ?? false,
    viewer: session !== null && !canChange(session),
    canChange: canChange(session),
  }
}

export function useCanChange() {
  return useSession().canChange
}
