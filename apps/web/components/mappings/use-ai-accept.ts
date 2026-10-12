'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  partsAcceptedAt,
  partsAcceptedWith,
  partsAcceptedWithChain,
} from '@/components/mappings/ai-review-accept'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { mappingDraftQuery, useAcceptAiProposedParts } from '@/lib/api/queries'
import { type AiReviewParts, aiReviewPartsSize, type MappingDraft } from '@edi-bridge/contracts'

import type { ProposedChain } from '@/components/mappings/ai-review-attention'
import type { RowLink } from '@/components/mappings/mapping-links'

function acceptable(parts: AiReviewParts) {
  return aiReviewPartsSize(parts) > 0 ? parts : null
}

// One mutation for the sheet and the link menu, so neither accepts while the other is busy.
export function useAiAccept(draft: MappingDraft) {
  const queryClient = useQueryClient()
  const mutation = useAcceptAiProposedParts(draft.mappingId)
  const saving = useGraphSaveState(draft.mappingId) === 'saving'
  const review = draft.aiReview
  const [closedReview, setClosedReview] = useState(false)

  if (closedReview && review) {
    setClosedReview(false)
  }

  const accept = (
    parts: AiReviewParts,
    { onSuccess, onError }: { onSuccess?: () => void; onError?: () => void } = {},
  ) =>
    mutation.mutate(parts, {
      onSuccess: (saved) => {
        setClosedReview(saved.aiReview === null)
        onSuccess?.()
      },
      onError: () => {
        void queryClient.invalidateQueries({
          queryKey: mappingDraftQuery(draft.mappingId).queryKey,
        })
        onError?.()
      },
    })

  return {
    pending: mutation.isPending || saving,
    closedReview: closedReview && review === null,
    partsOf: (link: RowLink) => review && acceptable(partsAcceptedWith(review, draft, link)),
    partsOfChain: (chain: ProposedChain) =>
      review && acceptable(partsAcceptedWithChain(review, draft, chain)),
    partsAt: (targetPath: string) =>
      review && acceptable(partsAcceptedAt(review, draft, targetPath)),
    accept,
  }
}

export type AiAccept = ReturnType<typeof useAiAccept>
