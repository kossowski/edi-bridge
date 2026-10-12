'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  const navigation = 'navigation' in window ? window.navigation : undefined
  const onEntryChange = () => queueMicrotask(onChange)

  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  navigation?.addEventListener('currententrychange', onEntryChange)

  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('popstate', onChange)
    navigation?.removeEventListener('currententrychange', onEntryChange)
  }
}

export function useLocationHash() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => '',
  )
}
