'use client'

import { useCallback, useSyncExternalStore } from 'react'

// Kept for the session when the browser refuses storage, e.g. in a private window.
const memory = new Map<string, boolean>()

const listeners = new Set<() => void>()

function stored(key: string) {
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function store(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value))

    return true
  } catch {
    return false
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null) {
      memory.delete(event.key)
    }

    onChange()
  }

  listeners.add(onChange)
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useStoredFlag(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => memory.get(key) ?? stored(key),
    () => false,
  )

  const set = useCallback(
    (next: boolean) => {
      if (store(key, next)) {
        memory.delete(key)
      } else {
        memory.set(key, next)
      }

      listeners.forEach((listener) => listener())
    },
    [key],
  )

  return [value, set] as const
}
