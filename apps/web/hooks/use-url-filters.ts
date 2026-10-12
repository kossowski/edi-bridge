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

  useEffect(() => {
    latest.current = filters
  })

  const updateFilters = useCallback(
    (change: Partial<Filters>) => {
      const next = { ...latest.current, page: 1, ...change }

      latest.current = next
      setState((current) => ({ ...current, filters: next }))
      router.replace(`${pathname}?${toSearch(next)}`, { scroll: false })
    },
    [pathname, router, toSearch],
  )

  return [filters, updateFilters] as const
}
