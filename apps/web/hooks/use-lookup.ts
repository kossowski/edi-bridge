'use client'

import { type QueryKey, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useMemo } from 'react'

export function useLookup<Item extends { id: string }, Key extends QueryKey>(
  options: UseQueryOptions<Item[], Error, Item[], Key>,
) {
  const query = useQuery(options)

  const byId = useMemo(() => new Map(query.data?.map((item) => [item.id, item])), [query.data])

  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
    find: (id: string | null) => (id === null ? undefined : byId.get(id)),
  }
}
