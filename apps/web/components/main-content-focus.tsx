'use client'

import { useEffect } from 'react'

// The id of the page's main region, which the layouts render and the skip link targets.
export const mainContentId = 'main-content'

export function findMainContent(document: Document = globalThis.document) {
  return document.getElementById(mainContentId)
}

export function focusMainContent() {
  findMainContent()?.focus()
}

let focusRequested = false

export function focusMainContentOnNextPage() {
  focusRequested = true
}

export function MainContentFocus() {
  useEffect(() => {
    if (focusRequested) {
      focusRequested = false
      focusMainContent()
    }
  }, [])

  return null
}
