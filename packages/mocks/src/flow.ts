import { http, HttpResponse } from 'msw'

import {
  type FlowSummary,
  flowSummarySchema,
  flowsEndpoint,
  type MessageType,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seedTradingPartners } from './trading-partner'

type FlowDirection = 'inbound' | 'outbound'

const flowTemplates: ReadonlyArray<{ messageType: MessageType; direction: FlowDirection }> = [
  { messageType: 'ORDERS', direction: 'inbound' },
  { messageType: 'DESADV', direction: 'outbound' },
  { messageType: 'INVOIC', direction: 'outbound' },
  { messageType: 'CONTRL', direction: 'inbound' },
]

export const outboundMessageTypes: ReadonlyArray<MessageType> = flowTemplates.flatMap(
  ({ messageType, direction }) => (direction === 'outbound' ? [messageType] : []),
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

export function flowsHandler(apiUrl: string, flows: ReadonlyArray<FlowSummary> = seedFlows) {
  return http.get(`${apiUrl}${flowsEndpoint.path}`, () => HttpResponse.json(flows))
}
