import { z } from 'zod'

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
