import { z } from 'zod'

import { edifactStructureNodeSchema, localizedTextSchema } from './edifact'

import type { Endpoint } from './endpoint'
import type { Direction } from './run'

export const messageTypes = ['ORDERS', 'DESADV', 'INVOIC', 'CONTRL'] as const

export const messageTypeSchema = z.enum(messageTypes)

export type MessageType = z.infer<typeof messageTypeSchema>

export const messageTypeDirections = {
  ORDERS: 'inbound',
  DESADV: 'outbound',
  INVOIC: 'outbound',
  CONTRL: 'inbound',
} as const satisfies Record<MessageType, Direction>

export function directionOf({ messageType }: { messageType: MessageType }): Direction {
  return messageTypeDirections[messageType]
}

export const releases = ['D.96A', 'D.3'] as const

export const releaseSchema = z.enum(releases)

export type Release = z.infer<typeof releaseSchema>

export const messageTypeStructureSchema = z.object({
  messageType: messageTypeSchema,
  release: releaseSchema,
  name: localizedTextSchema,
  children: z.array(edifactStructureNodeSchema).min(1),
})

export type MessageTypeStructure = z.infer<typeof messageTypeStructureSchema>

export const messageTypeStructureEndpoint: Endpoint<
  MessageTypeStructure,
  undefined,
  undefined,
  '/message-types/:messageType/structure'
> = {
  method: 'GET',
  path: '/message-types/:messageType/structure',
  response: messageTypeStructureSchema,
}
