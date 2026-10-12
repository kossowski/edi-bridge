import {
  type QueryClient,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query'

import { reprocessRun, retryRun, waitForTradingPartner } from '@/lib/api/client'
import { homeKeys, interchangeKeys, runKeys, runQuery, taskKeys } from '@/lib/api/queries'
import { type RunDetail, runDetailSchema } from '@edi-bridge/contracts'

export type RunActionResult = { action: 'retried' | 'reprocessed'; run: RunDetail }

const runActionKeys = {
  all: (id: string) => [...runKeys.detail(id), 'action'] as const,
  retried: (id: string) => [...runActionKeys.all(id), 'retried'] as const,
  reprocessed: (id: string) => [...runActionKeys.all(id), 'reprocessed'] as const,
}

function storeRun(queryClient: QueryClient, run: RunDetail) {
  queryClient.setQueryData(runQuery(run.id).queryKey, run)
  void queryClient.invalidateQueries({ queryKey: runKeys.lists() })
  void queryClient.invalidateQueries({ queryKey: interchangeKeys.all() })
  void queryClient.invalidateQueries({ queryKey: taskKeys.all() })
  void queryClient.invalidateQueries({ queryKey: homeKeys.all() })
}

export function useRetryRun(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: runActionKeys.retried(id),
    mutationFn: () => retryRun(id),
    onSuccess: (updated) => storeRun(queryClient, updated),
  })
}

export function useReprocessRun(
  id: string,
  { onReprocessed }: { onReprocessed?: (replacing: RunDetail) => void } = {},
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: runActionKeys.reprocessed(id),
    mutationFn: (mappingVersionId: string) => reprocessRun(id, { mappingVersionId }),
    onSuccess: (replacing) => {
      storeRun(queryClient, replacing)
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(id) })
      onReprocessed?.(replacing)
    },
  })
}

export function useWaitForTradingPartner(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => waitForTradingPartner(id),
    onSuccess: (updated) => storeRun(queryClient, updated),
  })
}

function useActionResults(id: string, action: RunActionResult['action']) {
  return useMutationState({
    filters: { mutationKey: runActionKeys[action](id), status: 'success' },
    select: (mutation) => ({
      action,
      run: runDetailSchema.parse(mutation.state.data),
      submittedAt: mutation.state.submittedAt,
    }),
  })
}

export function useLatestRunActionResult(id: string): RunActionResult | null {
  const results = [...useActionResults(id, 'retried'), ...useActionResults(id, 'reprocessed')]
  const latest = results.toSorted((a, b) => a.submittedAt - b.submittedAt).at(-1)

  return latest ? { action: latest.action, run: latest.run } : null
}
