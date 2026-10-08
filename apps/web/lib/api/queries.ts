import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import type { RunListQuery } from '@edi-bridge/contracts'

import { getCurrentWorkspace, listFlows, listRuns, listTradingPartners } from './client'

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})

export function runsQuery(query: RunListQuery) {
  return queryOptions({
    queryKey: ['runs', 'list', query],
    queryFn: () => listRuns(query),
    placeholderData: keepPreviousData,
  })
}

export const tradingPartnersQuery = queryOptions({
  queryKey: ['trading-partners', 'list'],
  queryFn: listTradingPartners,
})

export const flowsQuery = queryOptions({
  queryKey: ['flows', 'list'],
  queryFn: listFlows,
})
