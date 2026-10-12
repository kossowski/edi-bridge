'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function useUrlTab<Tab extends string>(tabs: readonly { value: Tab }[], fallback: Tab) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function tabOf(value: string | null) {
    return tabs.find((tab) => tab.value === value)?.value ?? fallback
  }

  const fromUrl = tabOf(searchParams.get('tab'))
  const [tab, setTab] = useState(fromUrl)
  const [syncedUrlTab, setSyncedUrlTab] = useState(fromUrl)

  if (fromUrl !== syncedUrlTab) {
    setSyncedUrlTab(fromUrl)
    setTab(fromUrl)
  }

  function changeTab(value: string) {
    const next = tabOf(value)
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setTab(next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return [tab, changeTab] as const
}
