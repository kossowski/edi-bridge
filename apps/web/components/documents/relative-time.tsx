'use client'

import { useFormatter, useNow } from 'next-intl'

export function RelativeTime({ dateTime }: { dateTime: string }) {
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const date = new Date(dateTime)

  return (
    <time
      dateTime={dateTime}
      title={format.dateTime(date, { dateStyle: 'medium', timeStyle: 'medium' })}>
      {format.relativeTime(date, now)}
    </time>
  )
}
