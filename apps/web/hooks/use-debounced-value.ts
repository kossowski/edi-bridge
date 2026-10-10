'use client'

import { useEffect, useState } from 'react'

// `key` says when two values are the same, so a value that only got a new identity, e.g. a refetched
// Draft, neither restarts the wait nor counts as pending.
export function useDebouncedValue<Value>(value: Value, key: string, delay: number) {
  const [settled, setSettled] = useState({ value, key })
  const pending = settled.key !== key

  useEffect(() => {
    if (!pending) {
      return
    }

    const timer = setTimeout(() => setSettled({ value, key }), delay)

    return () => clearTimeout(timer)
  }, [delay, key, pending, value])

  return { value: settled.value, key: settled.key, pending }
}
