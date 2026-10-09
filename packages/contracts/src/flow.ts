import { z } from 'zod'

import { mappingVersionSummarySchema } from './mapping-version'
import { directionOf, messageTypeSchema } from './message-type'

import type { ChannelSummary } from './channel'
import type { Endpoint } from './endpoint'
import type { Direction } from './run'

export const flowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  tradingPartnerId: z.uuid(),
  messageType: messageTypeSchema,
})

export type FlowSummary = z.infer<typeof flowSummarySchema>

const editableFields = {
  name: z.string().trim().min(1).max(70),
  inboundChannelId: z.uuid(),
  destinationChannelId: z.uuid(),
}

// Message Type, Trading Partner and Mapping are fixed once the Flow exists, and the pinned
// Mapping Version only changes through the explicit move to a newer version.
export const flowInputSchema = z.object({
  ...editableFields,
  tradingPartnerId: z.uuid(),
  messageType: messageTypeSchema,
  mappingVersionId: z.uuid(),
})

export type FlowInput = z.infer<typeof flowInputSchema>

export const flowUpdateSchema = z.object(editableFields)

export type FlowUpdate = z.infer<typeof flowUpdateSchema>

export const flowSchema = flowSummarySchema.extend({
  ...editableFields,
  mappingVersion: mappingVersionSummarySchema,
  newerMappingVersions: z.array(mappingVersionSummarySchema),
})

export type Flow = z.infer<typeof flowSchema>

export const flowChannelFields = ['inboundChannelId', 'destinationChannelId'] as const

export type FlowChannelField = (typeof flowChannelFields)[number]

const channelDirections = {
  inboundChannelId: 'inbound',
  destinationChannelId: 'outbound',
} as const satisfies Record<FlowChannelField, Direction>

// An inbound Message arrives from the Trading Partner and goes to the company's own systems; an
// outbound one arrives from the own systems and goes to the Trading Partner.
export function fitsFlow(
  channel: Pick<ChannelSummary, 'direction' | 'tradingPartnerId'>,
  field: FlowChannelField,
  flow: Pick<FlowSummary, 'messageType' | 'tradingPartnerId'>,
) {
  const fromTradingPartner = (directionOf(flow) === 'inbound') === (field === 'inboundChannelId')

  return (
    channel.direction === channelDirections[field] &&
    channel.tradingPartnerId === (fromTradingPartner ? flow.tradingPartnerId : null)
  )
}

export const moveFlowMappingVersionBodySchema = z.object({ mappingVersionId: z.uuid() })

export type MoveFlowMappingVersionBody = z.infer<typeof moveFlowMappingVersionBodySchema>

export const flowsEndpoint: Endpoint<Flow[]> = {
  method: 'GET',
  path: '/flows',
  response: z.array(flowSchema),
}

export const flowEndpoint: Endpoint<Flow, undefined, undefined, '/flows/:id'> = {
  method: 'GET',
  path: '/flows/:id',
  response: flowSchema,
}

export const createFlowEndpoint: Endpoint<Flow, undefined, FlowInput, '/flows'> = {
  method: 'POST',
  path: '/flows',
  body: flowInputSchema,
  response: flowSchema,
}

export const updateFlowEndpoint: Endpoint<Flow, undefined, FlowUpdate, '/flows/:id'> = {
  method: 'PUT',
  path: '/flows/:id',
  body: flowUpdateSchema,
  response: flowSchema,
}

export const moveFlowMappingVersionEndpoint: Endpoint<
  Flow,
  undefined,
  MoveFlowMappingVersionBody,
  '/flows/:id/mapping-version'
> = {
  method: 'POST',
  path: '/flows/:id/mapping-version',
  body: moveFlowMappingVersionBodySchema,
  response: flowSchema,
}
