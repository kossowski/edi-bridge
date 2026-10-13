'use client'

import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'

import { autoStartSampleId, hrefWithoutAiDraftStart } from '@/components/mappings/ai-draft-run'
import { type AiDraftRunControls } from '@/components/mappings/use-ai-draft-run'
import { aiBudgetQuery, mappingSamplesQuery } from '@/lib/api/queries'

import type { AiBudget, MappingSample } from '@edi-bridge/contracts'

// The start link takes itself out of the address without a history entry, so a reload or going
// back does not start another AI draft.
function useRemoveStartLink(aiDraftRequested: boolean) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (aiDraftRequested) {
      router.replace(hrefWithoutAiDraftStart(pathname, searchParams, window.location.hash), {
        scroll: false,
      })
    }
  }, [aiDraftRequested, pathname, router, searchParams])
}

// The start link opens the dialog once the editor can decide, and starts the AI draft once its
// Sample Documents and budget are in, unless the user closed the dialog or started one meanwhile.
// The screen holds this state, so a remounted editor does not start again.
export function useAiDraftDialog({
  mappingId,
  aiDraftRequested,
  decidable,
  available,
  aiDraft,
}: {
  mappingId: string
  aiDraftRequested: boolean
  decidable: boolean
  available: boolean
  aiDraft: AiDraftRunControls
}) {
  const queryClient = useQueryClient()
  const [requestPending, setRequestPending] = useState(aiDraftRequested)
  const [open, setOpen] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const idle = aiDraft.run.status === 'idle'

  useRemoveStartLink(aiDraftRequested)

  if (requestPending && decidable) {
    setRequestPending(false)

    if (available) {
      setOpen(true)
      setAutoStart(true)
    }
  }

  if (autoStart && !idle) {
    setAutoStart(false)
  }

  const startWhenReady = useEffectEvent(
    (samples: ReadonlyArray<MappingSample> | undefined, budget: AiBudget | undefined) => {
      setAutoStart(false)

      const sampleId = autoStartSampleId(samples, budget)

      if (sampleId !== null && aiDraft.run.status === 'idle') {
        aiDraft.start(sampleId)
      }
    },
  )

  const waiting = open && autoStart && idle

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
