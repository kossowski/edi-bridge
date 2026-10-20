import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { orderLifecycleListQuerySchema } from '@edi-bridge/contracts'
import { createRun } from '@edi-bridge/mocks'

import { applyLiveEvent, invalidateLiveQueries, invalidateMissedLiveQueries } from './live-queries'
import {
  firstStepsQuery,
  homeKeys,
  orderLifecycleKeys,
  runKeys,
  tradingPartnerKeys,
} from './queries'

const tradingPartner = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }

const otherPartnerDetail = tradingPartnerKeys.detail('10000000-0000-4000-8000-000000000003')

function cached(...keys: QueryKey[]) {
  const queryClient = new QueryClient()

  for (const queryKey of keys) {
    queryClient.setQueryData(queryKey, {})
  }

  return {
    queryClient,
    invalidated: (queryKey: QueryKey) =>
      queryClient.getQueryState(queryKey)?.isInvalidated ?? false,
  }
}

describe('applyLiveEvent', () => {
  it("refreshes the changed Run and its Trading Partner's page at once", () => {
    const run = createRun({ tradingPartner })
    const partnerDetail = tradingPartnerKeys.detail(tradingPartner.id)
    const { queryClient, invalidated } = cached(runKeys.detail(run.id), partnerDetail)

    applyLiveEvent(queryClient, { type: 'run.changed', run })

    expect(invalidated(runKeys.detail(run.id))).toBe(true)
    expect(invalidated(partnerDetail)).toBe(true)
  })
})

describe('invalidateLiveQueries', () => {
  it("refreshes Home's first steps and the Orders list with the workspace views", () => {
    const ordersList = orderLifecycleKeys.list(orderLifecycleListQuerySchema.parse({}))

    const { queryClient, invalidated } = cached(
      homeKeys.all(),
      firstStepsQuery.queryKey,
      ordersList,
      tradingPartnerKeys.list(),
    )

    invalidateLiveQueries(queryClient)

    expect(invalidated(homeKeys.all())).toBe(true)
    expect(invalidated(firstStepsQuery.queryKey)).toBe(true)
    expect(invalidated(ordersList)).toBe(true)
    expect(invalidated(tradingPartnerKeys.list())).toBe(true)
  })
})

describe('invalidateMissedLiveQueries', () => {
  it('also refreshes every Trading Partner page after a reconnect', () => {
    const { queryClient, invalidated } = cached(firstStepsQuery.queryKey, otherPartnerDetail)

    invalidateMissedLiveQueries(queryClient)

    expect(invalidated(firstStepsQuery.queryKey)).toBe(true)
    expect(invalidated(otherPartnerDetail)).toBe(true)
  })
})
