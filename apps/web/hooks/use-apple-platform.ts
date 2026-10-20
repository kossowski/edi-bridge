'use client'

import { useClientValue } from '@/hooks/use-client-value'

export function useApplePlatform() {
  return useClientValue(() => /Mac|iPhone|iPad/.test(navigator.userAgent), false)
}
