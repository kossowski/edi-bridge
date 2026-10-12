'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useUrlTab<Tab extends string>(tabs: readonly { value: Tab }[], fallback: Tab) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function tabOf(value: string | null) {
    return tabs.find((tab) => tab.value === value)?.value ?? fallback
  }

  function changeTab(value: string) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tabOf(value))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return [tabOf(searchParams.get('tab')), changeTab] as const
}
