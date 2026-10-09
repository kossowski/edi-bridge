import { http, HttpResponse } from 'msw'

import {
  type Direction,
  type FlowSummary,
  flowSummarySchema,
  flowsEndpoint,
  type MessageType,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seedTradingPartners } from './trading-partner'

const flowTemplates: ReadonlyArray<{ messageType: MessageType; direction: Direction }> = [
  { messageType: 'ORDERS', direction: 'inbound' },
  { messageType: 'DESADV', direction: 'outbound' },
  { messageType: 'INVOIC', direction: 'outbound' },
  { messageType: 'CONTRL', direction: 'inbound' },
]

const directions = new Map(
  flowTemplates.map(({ messageType, direction }) => [messageType, direction]),
)

export function directionOf({ messageType }: { messageType: MessageType }): Direction {
  return directions.get(messageType)!
}

export const seedFlows: ReadonlyArray<FlowSummary> = seedTradingPartners
  .filter(({ onboarding }) => onboarding.testInterchangeSentAt !== null)
  .flatMap((tradingPartner, tradingPartnerIndex) =>
    flowTemplates.map(({ messageType, direction }, flowIndex) =>
      flowSummarySchema.parse({
        id: seedId(2, tradingPartnerIndex * flowTemplates.length + flowIndex + 1),
        name: `${tradingPartner.name.split(' ')[0]} ${messageType} ${direction}`,
        tradingPartnerId: tradingPartner.id,
        messageType,
      }),
    ),
  )

export function flowsHandler(apiUrl: string, flows: ReadonlyArray<FlowSummary> = seedFlows) {
  return http.get(`${apiUrl}${flowsEndpoint.path}`, () => HttpResponse.json(flows))
}
