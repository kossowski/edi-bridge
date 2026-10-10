'use client'

import {
  type MutationStatus,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'

import { useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { applyChange, type GraphChange, revertChange } from '@/components/mappings/mapping-graph'
import { saveMappingDraft } from '@/lib/api/client'
import { mappingDraftQuery, mappingKeys } from '@/lib/api/queries'

import type { MappingDraft } from '@edi-bridge/contracts'

// The canvas words the messages, since it still knows the names of what a change removes.
export type GraphSave = { change: GraphChange; saved: string; failed: string }

export type GraphSaveState = 'saving' | 'saved' | 'failed'

const saveStates = {
  idle: null,
  pending: 'saving',
  success: 'saved',
  error: 'failed',
} as const satisfies Record<MutationStatus, GraphSaveState | null>

// Each save sends the whole graph as the cache holds it, so the saves of one Mapping run one after
// another: a save reads the cache only once the one before it has settled, and so never sends a
// change that a failed save before it has taken back. Each change still shows at once.
export function useSaveGraph(mappingId: string) {
  const queryClient = useQueryClient()
  const store = useCanvasStoreApi()
  const { queryKey } = mappingDraftQuery(mappingId)
  const mutationKey = mappingKeys.graph(mappingId)

  // Only the last of several quick changes may write the server's answer into the cache;
  // an earlier answer would drop the changes made after it.
  const isLast = () => queryClient.isMutating({ mutationKey }) === 1

  const save = useMutation<MappingDraft, Error, GraphSave>({
    mutationKey,
    scope: { id: mutationKey.join('/') },
    mutationFn: () => {
      const draft = queryClient.getQueryData<MappingDraft>(queryKey)

      if (!draft) {
        throw new Error(`The Draft of Mapping ${mappingId} is not loaded`)
      }

      const { links, transforms, transformLinks } = draft

      return saveMappingDraft(mappingId, { links, transforms, transformLinks })
    },
    onMutate: async ({ change }) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<MappingDraft>(
        queryKey,
        (draft) => draft && { ...draft, ...applyChange(draft, change) },
      )
    },
    onSuccess: (saved, { saved: message }) => {
      if (isLast()) {
        queryClient.setQueryData(queryKey, saved)
      }

      store.getState().announce(message)
    },
    onError: (_error, { change, failed }) => {
      queryClient.setQueryData<MappingDraft>(
        queryKey,
        (draft) => draft && { ...draft, ...revertChange(draft, change) },
      )
      store.getState().setProblem(failed)
    },
    // Not awaited: the mutation reads as pending until onSettled resolves, so awaiting the
    // refetch would keep showing "Saving…" after the server has already confirmed the save.
    onSettled: () => {
      if (isLast()) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return save.mutate
}

export function useGraphSaveState(mappingId: string): GraphSaveState | null {
  const statuses = useMutationState({
    filters: { mutationKey: mappingKeys.graph(mappingId) },
    select: (mutation) => mutation.state.status,
  })

  return statuses.includes('pending') ? 'saving' : saveStates[statuses.at(-1) ?? 'idle']
}
