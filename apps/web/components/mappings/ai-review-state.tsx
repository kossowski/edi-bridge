'use client'

import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { AiBadge } from '@/components/mappings/ai-badge'
import { aiProposedCount } from '@/components/mappings/ai-marks'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { acceptAiDraft } from '@/lib/api/client'
import { mappingDraftQuery, storeAcceptedAiDraft } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'

import type { MappingDraft } from '@edi-bridge/contracts'

export function AiReviewState({
  draft,
  summaryId,
  publishHintId,
}: {
  draft: MappingDraft
  summaryId: string
  publishHintId: string
}) {
  const t = useTranslations('Mapping.aiReview')
  const queryClient = useQueryClient()
  const saving = useGraphSaveState(draft.mappingId) === 'saving'
  const doneRef = useRef<HTMLParagraphElement>(null)
  const [accepted, setAccepted] = useState(false)

  const accept = useMutation({
    mutationFn: () => acceptAiDraft(draft.mappingId),
    onSuccess: (saved) => {
      storeAcceptedAiDraft(queryClient, saved)
      setAccepted(true)
    },
    onError: () =>
      void queryClient.invalidateQueries({
        queryKey: mappingDraftQuery(draft.mappingId).queryKey,
      }),
  })

  const open = draft.aiReview !== null
  const done = accepted && !open

  useEffect(() => {
    if (done) {
      doneRef.current?.focus()
    }
  }, [done])

  return (
    <>
      <p
        ref={doneRef}
        role="status"
        tabIndex={-1}
        className="inline-flex basis-full items-center gap-1.5 text-sm text-emerald-800 outline-none empty:hidden dark:text-emerald-300">
        {done && (
          <>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden />
            {t('accepted')}
          </>
        )}
      </p>
      {open && (
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span id={summaryId} className="inline-flex flex-wrap items-center gap-2">
            <AiBadge label={t('open')} />
            {t('openSummary', { count: aiProposedCount(draft.aiReview) })}
          </span>
          <Button
            disabled={accept.isPending || saving}
            focusableWhenDisabled
            size="sm"
            onClick={() => accept.mutate()}>
            {accept.isPending ? t('accepting') : t('accept')}
          </Button>
          {accept.isError && (
            <span role="alert" className="text-red-800 dark:text-red-300">
              {t('acceptFailed')}
            </span>
          )}
          <span id={publishHintId} className="text-muted-foreground ms-auto">
            {t('publishBlocked')}
          </span>
        </div>
      )}
    </>
  )
}
