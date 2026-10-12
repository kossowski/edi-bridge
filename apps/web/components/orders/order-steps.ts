import {
  type OrderLifecycleMessage,
  type OrderLifecycleMessageType,
  oldestFirst,
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
      messages: oldestFirst(messages.filter((message) => message.messageType === messageType)),
    }
  })
}

export const latestMessageCount = 5

function needsAttention({ run, interchange }: OrderLifecycleMessage) {
  const acknowledgement = interchange?.acknowledgement

  return (
    run.replacedBy === null &&
    (run.status === 'failed' || acknowledgement === 'rejected' || acknowledgement === 'overdue')
  )
}

export function shownMessages(
  messages: ReadonlyArray<OrderLifecycleMessage>,
  expanded: boolean,
): ReadonlyArray<OrderLifecycleMessage> {
  const latestFrom = messages.length - latestMessageCount

  return expanded
    ? messages
    : messages.filter((message, index) => index >= latestFrom || needsAttention(message))
}
