'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'

import { detailCrumbHref } from '@/lib/breadcrumb'

type Names = ReadonlyMap<string, string>

const noNames: Names = new Map()

let names: Names = noNames

const listeners = new Set<() => void>()

function update(next: Names) {
  names = next

  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function useBreadcrumbNames() {
  return useSyncExternalStore(
    subscribe,
    () => names,
    () => noNames,
  )
}

export function useBreadcrumbName(name: string | undefined) {
  const href = detailCrumbHref(usePathname())

  useEffect(() => {
    if (!href || !name) {
      return
    }

    update(new Map(names).set(href, name))

    return () => {
      const next = new Map(names)
      next.delete(href)
      update(next)
    }
  }, [href, name])
}
