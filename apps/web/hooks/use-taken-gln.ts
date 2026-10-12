'use client'

import { useState } from 'react'

import { isConflict } from '@/lib/api/client'
import { isTakenGln, normalizeGln } from '@/lib/forms/gln'

export function useTakenGln() {
  const [takenGln, setTakenGln] = useState<string | null>(null)

  function remember(error: Error, gln: string | null) {
    if (!isConflict(error)) {
      return false
    }

    setTakenGln(gln === null ? null : normalizeGln(gln))

    return true
  }

  return { takenGln, remember, isTaken: (gln: string | null) => isTakenGln(gln, takenGln) }
}
