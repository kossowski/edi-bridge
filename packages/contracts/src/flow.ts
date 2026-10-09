import { z } from 'zod'

import { mappingVersionSummarySchema } from './mapping-version'
import { messageTypeSchema } from './message-type'

import type { Endpoint } from './endpoint'

export const flowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  tradingPartnerId: z.uuid(),
  messageType: messageTypeSchema,
})

export type FlowSummary = z.infer<typeof flowSummarySchema>

const flowRoute = {
  name: z.string().trim().min(1).max(70),
  inboundChannelId: z.uuid(),
  destinationChannelId: z.uuid(),
}

// Message Type, Trading Partner and Mapping are fixed once the Flow exists, and the pinned
// Mapping Version only changes through the explicit move to a newer version.
export const flowInputSchema = z.object({
  ...flowRoute,
  tradingPartnerId: z.uuid(),
  messageType: messageTypeSchema,
  mappingVersionId: z.uuid(),
})

export type FlowInput = z.infer<typeof flowInputSchema>

export const flowUpdateSchema = z.object(flowRoute)

export type FlowUpdate = z.infer<typeof flowUpdateSchema>

export const flowSchema = flowSummarySchema.extend({
  ...flowRoute,
  mappingVersion: mappingVersionSummarySchema,
  // Published versions of the same Mapping that are newer than the pinned one, newest first.
  newerMappingVersions: z.array(mappingVersionSummarySchema),
})

export type Flow = z.infer<typeof flowSchema>

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
