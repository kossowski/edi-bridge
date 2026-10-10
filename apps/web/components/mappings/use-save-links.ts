'use client'

import {
  type MutationStatus,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { revertChange } from '@/components/mappings/mapping-links'
import { saveMappingLinks } from '@/lib/api/client'
import { mappingDraftQuery, mappingKeys } from '@/lib/api/queries'

import type { LinkChange } from '@/components/mappings/mapping-links'
import type { MappingDraft } from '@edi-bridge/contracts'

const messages = {
  add: { saved: 'added', failed: 'addFailed' },
  remove: { saved: 'removed', failed: 'removeFailed' },
} as const satisfies Record<LinkChange['kind'], { saved: string; failed: string }>

export type LinkSaveState = 'saving' | 'saved' | 'failed'

const saveStates = {
  idle: null,
  pending: 'saving',
  success: 'saved',
  error: 'failed',
} as const satisfies Record<MutationStatus, LinkSaveState | null>

export function useSaveLinks(mappingId: string) {
  const t = useTranslations('Mapping.links')
  const queryClient = useQueryClient()
  const store = useCanvasStoreApi()
  const { queryKey } = mappingDraftQuery(mappingId)
  const mutationKey = mappingKeys.links(mappingId)

  // Only the last of several quick changes may write the server's answer into the cache;
  // an earlier answer would drop the changes made after it.
  const isLast = () => queryClient.isMutating({ mutationKey }) === 1

  const save = useMutation({
    mutationKey,
    mutationFn: ({ links }: LinkChange) => saveMappingLinks(mappingId, { links }),
    onMutate: async ({ links }) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<MappingDraft>(queryKey, (draft) => draft && { ...draft, links })
    },
    onSuccess: (saved, { kind, link }) => {
      if (isLast()) {
        queryClient.setQueryData(queryKey, saved)
      }

      store
        .getState()
        .announce(t(messages[kind].saved, { source: link.sourcePath, target: link.targetPath }))
    },
    onError: (_error, change) => {
      const { kind, link } = change

      queryClient.setQueryData<MappingDraft>(
        queryKey,
        (draft) => draft && { ...draft, links: revertChange(draft.links, change) },
      )
      store
        .getState()
        .setProblem(t(messages[kind].failed, { source: link.sourcePath, target: link.targetPath }))
    },
    onSettled: async () => {
      if (isLast()) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return save.mutate
}

export function useLinkSaveState(mappingId: string): LinkSaveState | null {
  const statuses = useMutationState({
    filters: { mutationKey: mappingKeys.links(mappingId) },
    select: (mutation) => mutation.state.status,
  })

  return statuses.includes('pending') ? 'saving' : saveStates[statuses.at(-1) ?? 'idle']
}
