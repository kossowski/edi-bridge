import type { TradingPartner } from '@edi-bridge/contracts'

export const hour = 60 * 60 * 1000

export function overdueSinceOf(
  sentAt: string,
  { acknowledgementTimeLimitHours }: Pick<TradingPartner, 'acknowledgementTimeLimitHours'>,
) {
  return Date.parse(sentAt) + acknowledgementTimeLimitHours * hour
}
