'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SearchParamsReader } from '@/lib/search-params'

export type UpdateFilters<Filters> = (
  change: Partial<Filters>,
  options?: { replace?: boolean },
) => void

type SearchBurst = { before: string; searches: Set<string> }

function isSearchOnly<Filters>(change: Partial<Filters>) {
  const keys = Object.keys(change)

  return keys.length === 1 && keys[0] === 'q'
}

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
  const burst = useRef<SearchBurst>(undefined)

  useEffect(() => {
    latest.current = filters
  })

  useEffect(() => {
    // Back, Forward or a link moved the URL, so the next search starts an entry of its own.
    if (!burst.current?.searches.has(search)) {
      burst.current = undefined
    }
  }, [search])

  const updateFilters = useCallback<UpdateFilters<Filters>>(
    (change, options) => {
      const current = toSearch(latest.current)
      const next = { ...latest.current, page: 1, ...change }
      const nextSearch = toSearch(next)
      const href = `${pathname}?${nextSearch}`

      latest.current = next
      setState((previous) => ({ ...previous, filters: next }))

      if (nextSearch === current) {
        return
      }

      const scroll = { scroll: false }

      if (options?.replace || !isSearchOnly(change)) {
        burst.current = undefined
        router[options?.replace ? 'replace' : 'push'](href, scroll)
      } else if (!burst.current) {
        burst.current = { before: current, searches: new Set([nextSearch]) }
        router.push(href, scroll)
      } else if (nextSearch === burst.current.before) {
        // Replacing would copy the entry before the burst, and Back would seem to do nothing.
        burst.current = undefined
        router.back()
      } else {
        burst.current.searches.add(nextSearch)
        router.replace(href, scroll)
      }
    },
    [pathname, router, toSearch],
  )

  return [filters, updateFilters] as const
}
