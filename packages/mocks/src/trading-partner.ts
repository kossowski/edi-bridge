import { http, HttpResponse } from 'msw'

import {
  type TradingPartnerSummary,
  tradingPartnerSummarySchema,
  tradingPartnersEndpoint,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'

const partnerNames = [
  'Hansemarkt GmbH',
  'Alpenfrisch Märkte AG',
  'Rheinkauf eG',
  'Elbtal Warenhaus KG',
  'Spreewald Frische GmbH',
  'Bodensee Handelshaus AG',
]

export const seedTradingPartners: ReadonlyArray<TradingPartnerSummary> = partnerNames.map(
  (name, index) => tradingPartnerSummarySchema.parse({ id: seedId(1, index + 1), name }),
)

export function tradingPartnersHandler(
  apiUrl: string,
  tradingPartners: ReadonlyArray<TradingPartnerSummary> = seedTradingPartners,
) {
  return http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
    HttpResponse.json(tradingPartners),
  )
}
