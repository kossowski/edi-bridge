'use client'

import { useEffect, useEffectEvent } from 'react'

export function useSearchShortcut(onPress: () => void) {
  const press = useEffectEvent(onPress)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        press()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
