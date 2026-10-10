'use client'

import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { saveMappingLinks } from '@/lib/api/client'
import { mappingDraftQuery, mappingKeys } from '@/lib/api/queries'

import type { LinkChange } from '@/components/mappings/mapping-links'
import type { MappingDraft } from '@edi-bridge/contracts'

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
      const previous = queryClient.getQueryData<MappingDraft>(queryKey)

      queryClient.setQueryData<MappingDraft>(queryKey, (draft) => draft && { ...draft, links })

      return { previous }
    },
    onSuccess: (saved, { kind, link }) => {
      if (isLast()) {
        queryClient.setQueryData(queryKey, saved)
      }

      store.getState().setLastSave('saved')
      store.getState().announce(
        t(kind === 'add' ? 'added' : 'removed', {
          source: link.sourcePath,
          target: link.targetPath,
        }),
      )
    },
    onError: (_error, { kind, link }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }

      const { setLastSave, setProblem } = store.getState()

      setLastSave('failed')
      setProblem(
        t(kind === 'add' ? 'addFailed' : 'removeFailed', {
          source: link.sourcePath,
          target: link.targetPath,
        }),
      )
    },
    onSettled: async () => {
      if (isLast()) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })

  return save.mutate
}

export function useSavingLinks(mappingId: string) {
  return useIsMutating({ mutationKey: mappingKeys.links(mappingId) }) > 0
}
