'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'

import { focusMainContentOnNextPage } from '@/components/main-content-focus'
import { sessionQuery } from '@/lib/api/queries'

import type { SignedIn } from '@edi-bridge/contracts'

export function useEnterWorkspace<Variables>(
  signInWith: (variables: Variables) => Promise<SignedIn>,
) {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: async (variables: Variables) => {
      await signInWith(variables)
      queryClient.clear()
      await queryClient.prefetchQuery(sessionQuery)
    },
    onSuccess: () => {
      focusMainContentOnNextPage()
      router.replace('/')
    },
  })
}

export function isEntering(mutation: { isPending: boolean; isSuccess: boolean }) {
  return mutation.isPending || mutation.isSuccess
}
