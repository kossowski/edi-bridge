'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { openLiveEvents } from '@/lib/api/client'
import {
  applyLiveEvent,
  invalidateLiveQueries,
  invalidateMissedLiveQueries,
} from '@/lib/api/live-queries'
import { parseLiveEvent } from '@edi-bridge/contracts'

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

const throttleMs = 2000

const offlineAfterFailures = 3

const maxBackoffMs = 30_000

function backoffMs(failures: number) {
  const base = Math.min(maxBackoffMs, 1000 * 2 ** (failures - 1))

  return base / 2 + Math.random() * (base / 2)
}

export function useLiveEvents(): LiveStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    let source: EventSource | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let throttleTimer: ReturnType<typeof setTimeout> | undefined
    let lastFlush = 0
    let missedEvents = false
    let failures = 0
    let connectedBefore = false
    let disposed = false

    function flush() {
      throttleTimer = undefined
      lastFlush = Date.now()

      if (missedEvents) {
        missedEvents = false
        invalidateMissedLiveQueries(queryClient)
      } else {
        invalidateLiveQueries(queryClient)
      }
    }

    function scheduleFlush() {
      if (throttleTimer === undefined) {
        throttleTimer = setTimeout(flush, Math.max(0, lastFlush + throttleMs - Date.now()))
      }
    }

    function fail() {
      if (disposed) {
        return
      }

      failures += 1
      setStatus(failures >= offlineAfterFailures ? 'offline' : 'reconnecting')
      retryTimer = setTimeout(connect, backoffMs(failures))
    }

    function connect() {
      void openLiveEvents().then((opened) => {
        if (disposed) {
          opened.close()

          return
        }

        source = opened

        opened.addEventListener('open', () => {
          if (connectedBefore) {
            missedEvents = true
            scheduleFlush()
          }

          connectedBefore = true
          failures = 0
          setStatus('connected')
        })

        opened.addEventListener('message', ({ data }: MessageEvent<string>) => {
          const event = parseLiveEvent(data)

          if (event) {
            applyLiveEvent(queryClient, event)
            scheduleFlush()
          }
        })

        opened.addEventListener('error', () => {
          opened.close()
          fail()
        })
      }, fail)
    }

    connect()

    return () => {
      disposed = true
      source?.close()
      clearTimeout(retryTimer)
      clearTimeout(throttleTimer)
    }
  }, [queryClient])

  return status
}
