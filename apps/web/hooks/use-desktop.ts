'use client'

import { useSyncExternalStore } from 'react'

// Matches Tailwind's `lg` breakpoint, so CSS and script agree on what counts as desktop.
const desktopQuery = '(min-width: 64rem)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(desktopQuery)
  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}

export function useDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  )
}
