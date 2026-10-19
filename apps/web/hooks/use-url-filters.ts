'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SearchParamsReader } from '@/lib/search-params'

export function useUrlFilters<Filters extends { page: number }>(
  parse: (params: SearchParamsReader) => Filters,
  toSearch: (filters: Filters) => string,
) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const search = searchParams.toString()

  const [state, setState] = useState(() => ({ search, filters: parse(searchParams) }))

  let { filters } = state

  if (state.search !== search) {
    filters = parse(searchParams)
    setState({ search, filters })
  }

  const latest = useRef(filters)
  // The search the last search-only change navigated to; a typing burst replaces that entry.
  const searchEntry = useRef<string>(undefined)

  useEffect(() => {
    latest.current = filters
  })

  const updateFilters = useCallback(
    (change: Partial<Filters>) => {
      const current = toSearch(latest.current)
      const next = { ...latest.current, page: 1, ...change }
      const nextSearch = toSearch(next)

      latest.current = next
      setState((previous) => ({ ...previous, filters: next }))

      if (nextSearch === current) {
        return
      }

      const searchOnly = Object.keys(change).join() === 'q'
      const method = searchOnly && searchEntry.current === current ? 'replace' : 'push'

      searchEntry.current = searchOnly ? nextSearch : undefined
      router[method](`${pathname}?${nextSearch}`, { scroll: false })
    },
    [pathname, router, toSearch],
  )

  return [filters, updateFilters] as const
}
