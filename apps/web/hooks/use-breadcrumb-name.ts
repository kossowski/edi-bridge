'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'

import { detailCrumbHref } from '@/lib/breadcrumb'

type BreadcrumbNames = ReadonlyMap<string, string>

const noBreadcrumbNames: BreadcrumbNames = new Map()

let breadcrumbNames: BreadcrumbNames = noBreadcrumbNames

const breadcrumbNameListeners = new Set<() => void>()

function updateBreadcrumbNames(next: BreadcrumbNames) {
  breadcrumbNames = next

  for (const listener of breadcrumbNameListeners) {
    listener()
  }
}

function subscribeToBreadcrumbNames(listener: () => void) {
  breadcrumbNameListeners.add(listener)

  return () => {
    breadcrumbNameListeners.delete(listener)
  }
}

export function useBreadcrumbNames() {
  return useSyncExternalStore(
    subscribeToBreadcrumbNames,
    () => breadcrumbNames,
    () => noBreadcrumbNames,
  )
}

export function useBreadcrumbName(name: string | undefined) {
  const href = detailCrumbHref(usePathname())

  useEffect(() => {
    if (!href || !name) {
      return
    }

    updateBreadcrumbNames(new Map(breadcrumbNames).set(href, name))

    return () => {
      const next = new Map(breadcrumbNames)
      next.delete(href)
      updateBreadcrumbNames(next)
    }
  }, [href, name])
}
