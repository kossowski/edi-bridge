import { z } from 'zod'

import { messageTypeSchema } from './message-type'

import type { Endpoint } from './endpoint'

export const flowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  tradingPartnerId: z.uuid(),
  messageType: messageTypeSchema,
})

export type FlowSummary = z.infer<typeof flowSummarySchema>

export const flowsEndpoint: Endpoint<FlowSummary[]> = {
  method: 'GET',
  path: '/flows',
  response: z.array(flowSummarySchema),
}
