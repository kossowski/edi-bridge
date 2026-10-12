'use client'

import { useFormatter, useTranslations } from 'next-intl'

import { type BucketRow, rangeFormats, tickFormats } from '@/components/home/home-data'

import type { HomeWindow } from '@edi-bridge/contracts'

export function useFormats(timeWindow: HomeWindow) {
  const t = useTranslations('Home')
  const format = useFormatter()

  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 1 })

  return {
    tick: (start: string) => format.dateTime(new Date(start), tickFormats[timeWindow]),
    range: ({ start, end }: Pick<BucketRow, 'start' | 'end'>) =>
      format.dateTimeRange(new Date(start), new Date(end), rangeFormats[timeWindow]),
    count: (value: number) => format.number(value),
    dateTime: (value: string) =>
      format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }),
    compact: (value: number) => format.number(value, { notation: 'compact' }),
    percent,
    errorRate: (value: number | null) => (value === null ? t('noErrorRate') : percent(value)),
  }
}
