'use client'

import { createContext, type ReactNode, use } from 'react'

import { type LiveStatus, useLiveEvents } from '@/hooks/use-live-events'

const LiveStatusContext = createContext<LiveStatus | null>(null)

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const status = useLiveEvents()

  return <LiveStatusContext value={status}>{children}</LiveStatusContext>
}

export function useLiveStatus(): LiveStatus {
  const status = use(LiveStatusContext)

  if (status === null) {
    throw new Error('useLiveStatus needs a LiveEventsProvider')
  }

  return status
}
