import {
  type Direction,
  type OrderLifecycle,
  type OrderLifecycleMessage,
  type OrderLifecycleMessageType,
  orderLifecycleMessageTypes,
  type OrderLifecycleStatus,
  toOrderLifecycleSummary,
} from '@edi-bridge/contracts'

export type OrderVerdictReason =
  | 'failed'
  | 'rejected'
  | 'overdue'
  | 'confirmationNotSent'
  | 'resendAwaited'
  | 'confirmationPending'
  | 'inProgress'
  | 'nextDocument'
  | 'confirmationNotTracked'
  | 'done'

type MessageReason = Exclude<OrderVerdictReason, 'nextDocument' | 'done'>

export type OrderVerdict = {
  status: OrderLifecycleStatus
  done: number
  total: number
} & (
  | { reason: MessageReason; messageType: OrderLifecycleMessageType; direction: Direction }
  | { reason: 'nextDocument'; messageType: OrderLifecycleMessageType; direction: null }
  | { reason: 'done'; messageType: null; direction: null }
)

const messageReasons: ReadonlyArray<[MessageReason, (message: OrderLifecycleMessage) => boolean]> =
  [
    ['failed', ({ run }) => run.status === 'failed' && run.waitingForTradingPartnerSince === null],
    ['rejected', ({ interchange }) => interchange?.acknowledgement === 'rejected'],
    ['overdue', ({ interchange }) => interchange?.acknowledgement === 'overdue'],
    ['confirmationNotSent', ({ interchange }) => interchange?.notSentReason != null],
    ['resendAwaited', ({ run }) => run.status === 'failed'],
    ['confirmationPending', ({ interchange }) => interchange?.acknowledgement === 'pending'],
    ['inProgress', ({ run }) => run.status === 'received' || run.status === 'processing'],
  ]

export function confirmationNotTracked({ direction, run, interchange }: OrderLifecycleMessage) {
  return (
    direction === 'outbound' &&
    run.status === 'delivered' &&
    interchange !== null &&
    interchange.acknowledgement === null
  )
}

function inStepOrder(messages: ReadonlyArray<OrderLifecycleMessage>) {
  return messages.toSorted(
    (a, b) =>
      orderLifecycleMessageTypes.indexOf(a.messageType) -
        orderLifecycleMessageTypes.indexOf(b.messageType) ||
      Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
  )
}

export function orderVerdictOf(lifecycle: OrderLifecycle): OrderVerdict {
  const { status, steps } = toOrderLifecycleSummary(lifecycle)
  const done = steps.filter(({ state }) => state === 'done').length
  const counts = { status, done, total: steps.length }

  const current = inStepOrder(
    lifecycle.messages.filter(({ run }) => run.replacedBy === null && run.status !== 'duplicate'),
  )

  for (const [reason, matches] of messageReasons) {
    const message = current.find(matches)

    if (message) {
      return { ...counts, reason, messageType: message.messageType, direction: message.direction }
    }
  }

  const next = steps.find(({ state }) => state !== 'done')

  if (next) {
    return { ...counts, reason: 'nextDocument', messageType: next.messageType, direction: null }
  }

  const untracked = current.find(confirmationNotTracked)

  return untracked
    ? {
        ...counts,
        reason: 'confirmationNotTracked',
        messageType: untracked.messageType,
        direction: untracked.direction,
      }
    : { ...counts, reason: 'done', messageType: null, direction: null }
}

const hourMs = 60 * 60 * 1000

export type WaitingTime = { unit: 'hours' | 'days'; value: number }

export function waitingTimeOf(since: string, now: Date): WaitingTime {
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / hourMs))

  return hours < 48
    ? { unit: 'hours', value: hours }
    : { unit: 'days', value: Math.floor(hours / 24) }
}
