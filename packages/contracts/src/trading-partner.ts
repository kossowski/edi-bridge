import { z } from 'zod'

import type { Endpoint } from './endpoint'

export const tradingPartnerSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
})

export type TradingPartnerSummary = z.infer<typeof tradingPartnerSummarySchema>

export const tradingPartnersEndpoint: Endpoint<TradingPartnerSummary[]> = {
  method: 'GET',
  path: '/trading-partners',
  response: z.array(tradingPartnerSummarySchema),
}
