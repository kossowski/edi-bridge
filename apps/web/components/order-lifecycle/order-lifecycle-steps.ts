import {
  type AcknowledgementState,
  acknowledgementStates,
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

export const latestMessageCount = 5

export function shownMessages<Message>(
  messages: ReadonlyArray<Message>,
  expanded: boolean,
): ReadonlyArray<Message> {
  return expanded ? messages : messages.slice(-latestMessageCount)
}

export function acknowledgementCounts(
  messages: ReadonlyArray<OrderLifecycleMessage>,
): Array<{ state: AcknowledgementState; count: number }> {
  return acknowledgementStates
    .map((state) => ({
      state,
      count: messages.filter(
        (message) => !message.run.replacedBy && message.interchange?.acknowledgement === state,
      ).length,
    }))
    .filter(({ count }) => count > 0)
}
