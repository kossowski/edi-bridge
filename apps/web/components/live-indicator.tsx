'use client'

import { Loading03Icon, Wifi01Icon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { LiveStatus } from '@/hooks/use-live-events'

const liveStatusIcons: Record<LiveStatus, IconSvgElement> = {
  connecting: Loading03Icon,
  connected: Wifi01Icon,
  reconnecting: Loading03Icon,
  offline: WifiDisconnected01Icon,
}

const liveStatusStyles: Record<LiveStatus, string> = {
  connecting: 'text-muted-foreground',
  connected: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  reconnecting: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  offline: 'bg-red-500/10 text-red-800 dark:text-red-300',
}

const announceInterruptionAfterMs = 3000

function useAnnouncement(status: LiveStatus) {
  const t = useTranslations('LiveIndicator.announcement')
  const [previous, setPrevious] = useState(status)
  const [interrupted, setInterrupted] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  if (status !== previous) {
    setPrevious(status)

    if (status === 'offline') {
      setInterrupted(true)
      setAnnouncement(t('offline'))
    } else if (status === 'connected' && interrupted) {
      setInterrupted(false)
      setAnnouncement(t('connected'))
    }
  }

  useEffect(() => {
    if (status !== 'reconnecting') {
      return
    }

    const timer = setTimeout(() => {
      setInterrupted(true)
      setAnnouncement(t('reconnecting'))
    }, announceInterruptionAfterMs)

    return () => clearTimeout(timer)
  }, [status, t])

  return announcement
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  const t = useTranslations('LiveIndicator')
  const announcement = useAnnouncement(status)
  const busy = status === 'connecting' || status === 'reconnecting'

  return (
    <>
      <Badge variant="outline" className={cn('gap-1', liveStatusStyles[status])}>
        <HugeiconsIcon
          icon={liveStatusIcons[status]}
          strokeWidth={2}
          aria-hidden
          className={cn(busy && 'motion-safe:animate-spin')}
        />
        <span className="sr-only">{t('label')}: </span>
        {t(`status.${status}`)}
      </Badge>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  )
}
