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

// The toolbar, the review sheet and the canvas each ask; the preview behind the warnings is one
// shared request.
export function useReviewAttention(
  draft: MappingDraft,
  targetItems: ReadonlyArray<TreeItem> | undefined,
) {
  const marks = useAiMarks()
  const review = marks.open ? draft.aiReview : null
  const { preview, updating } = useDraftPreview(draft, review?.sampleId ?? null)
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

  return { attention, onCanvas, preview, updating }
}
