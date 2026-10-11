'use client'

import type { ReactNode } from 'react'

import { NotFoundMessage } from '@/components/not-found-message'
import { useSession } from '@/hooks/use-session'

export function OperatorOnly({ children }: { children: ReactNode }) {
  const { operator } = useSession()

  return operator ? children : <NotFoundMessage />
}
