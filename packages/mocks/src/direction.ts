import type { Direction, MessageType } from '@edi-bridge/contracts'

export const messageTypeDirections: ReadonlyArray<{
  messageType: MessageType
  direction: Direction
}> = [
  { messageType: 'ORDERS', direction: 'inbound' },
  { messageType: 'DESADV', direction: 'outbound' },
  { messageType: 'INVOIC', direction: 'outbound' },
  { messageType: 'CONTRL', direction: 'inbound' },
]

const directions = new Map(
  messageTypeDirections.map(({ messageType, direction }) => [messageType, direction]),
)

export function directionOf({ messageType }: { messageType: MessageType }): Direction {
  return directions.get(messageType)!
}
