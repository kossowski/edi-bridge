'use client'

import { useQuery } from '@tanstack/react-query'

import { sessionQuery } from '@/lib/api/queries'
import { canChange } from '@/lib/session'

export function useSession() {
  const { data, error, isPending } = useQuery(sessionQuery)
  const session = data ?? null

  return {
    session,
    error,
    isPending,
    role: session?.role ?? null,
    operator: session?.operator ?? false,
    viewer: session !== null && !canChange(session),
    canChange: canChange(session),
  }
}

export function useCanChange() {
  return useSession().canChange
}
