import { type QueryClient } from '@tanstack/react-query'

import { type LiveEvent } from '@edi-bridge/contracts'

import {
  firstStepsQuery,
  homeKeys,
  interchangeKeys,
  orderLifecycleKeys,
  runKeys,
  taskKeys,
  tradingPartnerKeys,
} from './queries'

// Refreshes at once what the event names, so its Run and Trading Partner pages show it without delay.
export function applyLiveEvent(queryClient: QueryClient, event: LiveEvent) {
  switch (event.type) {
    case 'run.changed':
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(event.run.id) })
      // A test Interchange's hand-over and its CONTRL move the Trading Partner's onboarding.
      void queryClient.invalidateQueries({
        queryKey: tradingPartnerKeys.detail(event.run.tradingPartner.id),
      })
  }
}

// A run.changed carries no Acknowledgement state, so tasks and Interchanges refresh on every one.
export function invalidateLiveQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: homeKeys.all() })
  // Real traffic completes onboarding steps.
  void queryClient.invalidateQueries({ queryKey: firstStepsQuery.queryKey })
  void queryClient.invalidateQueries({ queryKey: runKeys.lists() })
  void queryClient.invalidateQueries({ queryKey: taskKeys.all() })
  void queryClient.invalidateQueries({ queryKey: interchangeKeys.all() })
  void queryClient.invalidateQueries({ queryKey: orderLifecycleKeys.all() })
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.list() })
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.activities() })
}

// The events missed while disconnected may have changed any Trading Partner's page.
export function invalidateMissedLiveQueries(queryClient: QueryClient) {
  invalidateLiveQueries(queryClient)
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.all() })
}
