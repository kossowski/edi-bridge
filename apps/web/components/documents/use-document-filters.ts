'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type DocumentFilters,
  documentFiltersSearch,
  parseDocumentFilters,
} from '@/components/documents/document-filters'

// The filters live in the URL; local state keeps the screen responsive until the router catches up.
export function useDocumentFilters() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const search = searchParams.toString()

  const [state, setState] = useState(() => ({
    search,
    filters: parseDocumentFilters(searchParams),
  }))

  let { filters } = state

  if (state.search !== search) {
    filters = parseDocumentFilters(searchParams)
    setState({ search, filters })
  }

  const latest = useRef(filters)

  useEffect(() => {
    latest.current = filters
  })

  const updateFilters = useCallback(
    (change: Partial<DocumentFilters>) => {
      const next = { ...latest.current, page: 1, ...change }

      latest.current = next
      setState((current) => ({ ...current, filters: next }))
      router.replace(`${pathname}?${documentFiltersSearch(next)}`, { scroll: false })
    },
    [pathname, router],
  )

  return [filters, updateFilters] as const
}
