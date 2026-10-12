import {
  type AcknowledgementState,
  acknowledgementStates,
  type OrderLifecycleMessage,
} from '@edi-bridge/contracts'

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
