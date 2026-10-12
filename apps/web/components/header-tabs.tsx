'use client'

import { type ReactNode, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

export const headerTabsId = 'header-tabs'

export function HeaderTabs({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(
    () => () => undefined,
    () => document.getElementById(headerTabsId),
    () => null,
  )

  return target ? createPortal(children, target) : null
}
