import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { createTradingPartner } from '@edi-bridge/mocks'

import { storeSavedTradingPartner, tradingPartnerQuery, tradingPartnersQuery } from './queries'

describe('storeSavedTradingPartner', () => {
  it('caches the saved Trading Partner and marks the list as stale', () => {
    const queryClient = new QueryClient()
    const saved = createTradingPartner()
    queryClient.setQueryData(tradingPartnersQuery.queryKey, [])

    storeSavedTradingPartner(queryClient, saved)

    expect(queryClient.getQueryData(tradingPartnerQuery(saved.id).queryKey)).toEqual(saved)
    expect(queryClient.getQueryState(tradingPartnersQuery.queryKey)?.isInvalidated).toBe(true)
  })
})
