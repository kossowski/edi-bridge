'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { previewGraph } from '@/components/mappings/mapping-preview'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { mappingPreviewQuery } from '@/lib/api/queries'

import type { MappingDraft } from '@edi-bridge/contracts'

// Long enough that typing into a transform's form does not send a preview per keystroke.
const previewDelay = 600

// The preview panel and the AI review wait the same time for the same graph, so they share one
// request when they look at the same Sample Document.
export function useDraftPreview(draft: MappingDraft, sampleId: string | null) {
  const graph = useMemo(() => previewGraph(draft), [draft])
  const key = useMemo(() => JSON.stringify(graph), [graph])
  const settled = useDebouncedValue(graph, key, previewDelay)

  const preview = useQuery({
    ...mappingPreviewQuery(draft.mappingId, sampleId ?? '', settled.value),
    enabled: sampleId !== null,
  })

  return {
    preview,
    key,
    settledKey: settled.key,
    updating: settled.pending || preview.isFetching,
  }
}
