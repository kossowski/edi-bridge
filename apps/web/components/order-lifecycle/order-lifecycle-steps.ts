import {
  type OrderLifecycleMessage,
  type OrderLifecycleMessageType,
  openMessageTypes,
  orderLifecycleMessageTypes,
} from '@edi-bridge/contracts'

export type OrderLifecycleStep = {
  messageType: OrderLifecycleMessageType
  open: boolean
  missing: boolean
  messages: OrderLifecycleMessage[]
}

export function orderLifecycleSteps(
  messages: ReadonlyArray<OrderLifecycleMessage>,
): OrderLifecycleStep[] {
  const openTypes = openMessageTypes(messages)

  return orderLifecycleMessageTypes.map((messageType, index) => {
    const empty = openTypes.includes(messageType)

    const open =
      empty && orderLifecycleMessageTypes.slice(index).every((type) => openTypes.includes(type))

    return {
      messageType,
      open,
      missing: empty && !open,
      messages: messages
        .filter((message) => message.messageType === messageType)
        .toSorted((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)),
    }
  })
}
