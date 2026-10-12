'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  const navigation = 'navigation' in window ? window.navigation : undefined

  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  navigation?.addEventListener('currententrychange', onChange)

  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
    navigation?.removeEventListener('currententrychange', onChange)
  }
}

export function useLocationHash() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => '',
  )
}
