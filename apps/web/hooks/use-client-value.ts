'use client'

import { useSyncExternalStore } from 'react'

function subscribeToNothing() {
  return () => {}
}

// Hydration sees serverValue too, so its markup matches the server render.
export function useClientValue<T>(getClientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeToNothing, getClientValue, () => serverValue)
}
