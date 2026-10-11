'use client'

import { useEffect } from 'react'

let focusRequested = false

export function focusMainContentOnNextPage() {
  focusRequested = true
}

export function MainContentFocus() {
  useEffect(() => {
    if (focusRequested) {
      focusRequested = false
      document.getElementById('main-content')?.focus()
    }
  }, [])

  return null
}
