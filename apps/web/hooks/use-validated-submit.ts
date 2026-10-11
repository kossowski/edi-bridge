'use client'

import { type FormEvent, type RefObject, useState } from 'react'

import type { UseMutationResult } from '@tanstack/react-query'

export function useValidatedSubmit<TData, TInput>({
  result,
  mutation,
  firstInvalid,
}: {
  result: { input: TInput } | { error: unknown }
  mutation: UseMutationResult<TData, Error, TInput>
  firstInvalid: RefObject<HTMLElement | null>
}) {
  const [submitted, setSubmitted] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (mutation.isPending) {
      return
    }

    setSubmitted(true)

    if ('error' in result) {
      firstInvalid.current?.focus()

      return
    }

    mutation.mutate(result.input, { onSuccess: () => setSubmitted(false) })
  }

  return { submitted, submit }
}
