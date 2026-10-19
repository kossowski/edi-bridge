import { z } from 'zod'

import { edifactStructureNodeSchema, localizedTextSchema } from './edifact'

import type { Endpoint } from './endpoint'

export const directions = ['inbound', 'outbound'] as const

export const directionSchema = z.enum(directions)

export type Direction = z.infer<typeof directionSchema>

export const messageTypes = ['ORDERS', 'DESADV', 'INVOIC', 'CONTRL'] as const

export const messageTypeSchema = z.enum(messageTypes)

export type MessageType = z.infer<typeof messageTypeSchema>

// The raw UNH type, not a MessageType: a Message of an unknown type is not routed either.
export const notRoutedMessagesSchema = z.array(z.object({ messageType: z.string().min(1) }))

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
