import type { RunSummary, TradingPartner } from '@edi-bridge/contracts'

import { hash } from './hash'

export const hour = 60 * 60 * 1000

export function overdueSinceOf(
  sentAt: string,
  { acknowledgementTimeLimitHours }: Pick<TradingPartner, 'acknowledgementTimeLimitHours'>,
) {
  return Date.parse(sentAt) + acknowledgementTimeLimitHours * hour
}

export function isUnacknowledged(run: Pick<RunSummary, 'id'>) {
  return hash(`overdue:${run.id}`) / 2 ** 32 < 0.02
}
