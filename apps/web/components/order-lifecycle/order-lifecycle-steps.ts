import {
  type OrderLifecycleMessage,
  type OrderLifecycleMessageType,
  openMessageTypes,
  orderLifecycleMessageTypes,
} from '@edi-bridge/contracts'

export type OrderLifecycleStep = {
  messageType: OrderLifecycleMessageType
  open: boolean
  messages: OrderLifecycleMessage[]
}

export function orderLifecycleSteps(
  messages: ReadonlyArray<OrderLifecycleMessage>,
): OrderLifecycleStep[] {
  const open = openMessageTypes(messages)

  return orderLifecycleMessageTypes.map((messageType) => ({
    messageType,
    open: open.includes(messageType),
    messages: messages
      .filter((message) => message.messageType === messageType)
      .toSorted((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)),
  }))
}
