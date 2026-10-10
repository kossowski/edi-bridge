'use client'

import { Loading03Icon, Wifi01Icon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

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

function useAnnouncement(status: LiveStatus) {
  const t = useTranslations('Overview.live.announcement')
  const [previous, setPrevious] = useState(status)
  const [connectedOnce, setConnectedOnce] = useState(status === 'connected')
  const [announcement, setAnnouncement] = useState('')

  if (status !== previous) {
    setPrevious(status)

    if (status === 'connected' && !connectedOnce) {
      setConnectedOnce(true)
    } else if (status === 'offline' || (connectedOnce && status !== 'connecting')) {
      setAnnouncement(t(status))
    }
  }

  return announcement
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  const t = useTranslations('Overview.live')
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
