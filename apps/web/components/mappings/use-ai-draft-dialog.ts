'use client'

import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'

import { autoStartSampleId, hrefWithoutAiDraftStart } from '@/components/mappings/ai-draft-run'
import { aiBudgetQuery, mappingSamplesQuery } from '@/lib/api/queries'

import type { AiBudget, MappingSample } from '@edi-bridge/contracts'

// The link takes itself out of the address without a history entry, so a reload or going back does
// not start another AI draft; the screen keeps the request it opened with.
export function useAiDraftStartLink(requested: boolean) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [startLink] = useState(requested)

  useEffect(() => {
    if (requested) {
      router.replace(hrefWithoutAiDraftStart(pathname, searchParams), { scroll: false })
    }
  }, [requested, pathname, router, searchParams])

  return startLink
}

// The start link opens the dialog on the first render that can decide, and starts the AI draft
// once its Sample Documents and budget are in, unless the user closed the dialog meanwhile.
export function useAiDraftDialog({
  mappingId,
  startLink,
  startAllowed,
  start,
}: {
  mappingId: string
  startLink: boolean
  startAllowed: boolean
  start: (sampleId: string) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [startLinkHandled, setStartLinkHandled] = useState(!startLink)
  const [autoStart, setAutoStart] = useState(false)

  if (!startLinkHandled) {
    setStartLinkHandled(true)

    if (startAllowed) {
      setOpen(true)
      setAutoStart(true)
    }
  }

  const startWhenReady = useEffectEvent(
    (samples: ReadonlyArray<MappingSample> | undefined, budget: AiBudget | undefined) => {
      setAutoStart(false)

      const sampleId = autoStartSampleId(samples, budget)

      if (sampleId !== null) {
        start(sampleId)
      }
    },
  )

  const waiting = open && autoStart

  useEffect(() => {
    if (!waiting) {
      return
    }

    let cancelled = false

    Promise.all([
      queryClient.fetchQuery(mappingSamplesQuery(mappingId)),
      queryClient.fetchQuery(aiBudgetQuery),
    ]).then(
      ([samples, budget]) => !cancelled && startWhenReady(samples, budget),
      () => !cancelled && startWhenReady(undefined, undefined),
    )

    return () => {
      cancelled = true
    }
  }, [waiting, mappingId, queryClient])

  function changeOpen(next: boolean) {
    setOpen(next)

    if (!next) {
      setAutoStart(false)
    }
  }

  return { open, onOpenChange: changeOpen }
}
