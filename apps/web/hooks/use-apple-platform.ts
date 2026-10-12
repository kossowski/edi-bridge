'use client'

import { useSyncExternalStore } from 'react'

function subscribeToNothing() {
  return () => {}
}

export function useApplePlatform() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  )
}
