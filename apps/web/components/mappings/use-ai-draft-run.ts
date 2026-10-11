'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type AiDraftProblem,
  type AiDraftRun,
  idleRun,
  runAfterEvent,
  runAfterProblem,
  startedRun,
} from '@/components/mappings/ai-draft-run'
import { aiBudgetExhaustedProblemOf, isAiReviewOpen, streamAiDraft } from '@/lib/api/client'
import { aiKeys, mappingDraftQuery, storeAiBudget, storeAiDraftedDraft } from '@/lib/api/queries'

export type AiDraftRunControls = ReturnType<typeof useAiDraftRun>

export function useAiDraftRun(mappingId: string) {
  const queryClient = useQueryClient()
  const [run, setRun] = useState<AiDraftRun>(idleRun)
  const controllerRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => abort, [abort])

  function start(sampleId: string) {
    abort()

    const controller = new AbortController()
    controllerRef.current = controller
    setRun(startedRun)

    const update = (next: (run: AiDraftRun) => AiDraftRun) => {
      if (!controller.signal.aborted) {
        setRun(next)
      }
    }

    const failWith = (problem: AiDraftProblem) => update((run) => runAfterProblem(run, problem))

    streamAiDraft(
      mappingId,
      { sampleId },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'drafted') {
            storeAiDraftedDraft(queryClient, event.draft)
          }

          if (event.type !== 'step') {
            void queryClient.invalidateQueries({ queryKey: aiKeys.budget() })
          }

          update((run) => runAfterEvent(run, event))
        },
      },
    ).then(
      () => failWith('interrupted'),
      (error: Error) => {
        const budgetProblem = aiBudgetExhaustedProblemOf(error)

        if (budgetProblem) {
          storeAiBudget(queryClient, budgetProblem.budget)
          failWith('budgetExhausted')
        } else if (isAiReviewOpen(error)) {
          void queryClient.invalidateQueries({ queryKey: mappingDraftQuery(mappingId).queryKey })
          failWith('reviewOpen')
        } else {
          failWith('interrupted')
        }
      },
    )
  }

  function stop() {
    abort()
    setRun((run) => runAfterProblem(run, 'stopped'))
    void queryClient.invalidateQueries({ queryKey: aiKeys.budget() })
  }

  function reset() {
    abort()
    setRun(idleRun)
  }

  return { run, start, stop, reset }
}
