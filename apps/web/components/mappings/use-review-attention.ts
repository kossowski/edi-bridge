'use client'

import { useMemo } from 'react'

import { useAiMarks } from '@/components/mappings/ai-marks'
import {
  attentionMarks,
  noAttention,
  reviewAttention,
} from '@/components/mappings/ai-review-attention'
import { useDraftPreview } from '@/components/mappings/use-draft-preview'

import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingDraft } from '@edi-bridge/contracts'

// The review sheet and the canvas only exist on desktop, so a small screen sends no preview for it.
export function useReviewAttention(
  draft: MappingDraft,
  targetItems: ReadonlyArray<TreeItem> | undefined,
  enabled: boolean,
) {
  const marks = useAiMarks()
  const review = enabled && marks.open ? draft.aiReview : null
  const sampleId = review?.sampleId ?? null
  const { preview, updating } = useDraftPreview(draft, sampleId)
  const notes = preview.data?.notes

  const attention = useMemo(
    () =>
      review && targetItems ? reviewAttention({ graph: draft, marks, targetItems, notes }) : null,
    [draft, marks, notes, review, targetItems],
  )

  const onCanvas = useMemo(
    () => (attention ? attentionMarks(marks, attention) : noAttention),
    [attention, marks],
  )

  return { attention, onCanvas, preview, updating, sampleId }
}

export type ReviewState = ReturnType<typeof useReviewAttention>
