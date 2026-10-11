'use client'

import type { ReactNode } from 'react'

import { NotFoundMessage } from '@/components/not-found-message'
import { useCanChange } from '@/hooks/use-session'

export function CanChangeOnly({ children }: { children: ReactNode }) {
  return useCanChange() ? children : <NotFoundMessage />
}
