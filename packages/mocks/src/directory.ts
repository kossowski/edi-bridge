import { http, HttpResponse } from 'msw'

import {
  type FlowSummary,
  flowSummarySchema,
  flowsEndpoint,
  type MessageType,
  type TradingPartnerSummary,
  tradingPartnerSummarySchema,
  tradingPartnersEndpoint,
} from '@edi-bridge/contracts'

function seedId(prefix: number, index: number) {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

const partnerNames = [
  'Hansemarkt GmbH',
  'Alpenfrisch Märkte AG',
  'Rheinkauf eG',
  'Elbtal Warenhaus KG',
  'Spreewald Frische GmbH',
  'Bodensee Handelshaus AG',
]

const flowTemplates: ReadonlyArray<{ messageType: MessageType; direction: string }> = [
  { messageType: 'ORDERS', direction: 'inbound' },
  { messageType: 'DESADV', direction: 'outbound' },
  { messageType: 'INVOIC', direction: 'outbound' },
  { messageType: 'CONTRL', direction: 'inbound' },
]

export const seedTradingPartners: ReadonlyArray<TradingPartnerSummary> = partnerNames.map(
  (name, index) => tradingPartnerSummarySchema.parse({ id: seedId(1, index + 1), name }),
)

export const seedFlows: ReadonlyArray<FlowSummary> = seedTradingPartners.flatMap(
  (partner, partnerIndex) =>
    flowTemplates.map(({ messageType, direction }, flowIndex) =>
      flowSummarySchema.parse({
        id: seedId(2, partnerIndex * flowTemplates.length + flowIndex + 1),
        name: `${partner.name.split(' ')[0]} ${messageType} ${direction}`,
        tradingPartnerId: partner.id,
        messageType,
      }),
    ),
)

export function tradingPartnersHandler(
  apiUrl: string,
  tradingPartners: ReadonlyArray<TradingPartnerSummary> = seedTradingPartners,
) {
  return http.get(`${apiUrl}${tradingPartnersEndpoint.path}`, () =>
    HttpResponse.json(tradingPartners),
  )
}

export function flowsHandler(apiUrl: string, flows: ReadonlyArray<FlowSummary> = seedFlows) {
  return http.get(`${apiUrl}${flowsEndpoint.path}`, () => HttpResponse.json(flows))
}
