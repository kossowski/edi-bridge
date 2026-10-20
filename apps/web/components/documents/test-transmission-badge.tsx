'use client'

import { TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { testModeClassName } from '@/components/trading-partners/test-mode-badge'
import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunDetail } from '@edi-bridge/contracts'

// A null test indicator means the Document expired, so nothing says whether it was a test.
export function isTestTransmission(run: RunDetail) {
  return run.testIndicator === true
}

export function TestTransmissionBadge() {
  const t = useTranslations('Document.header')

  return (
    <Badge variant="outline" className={cn('gap-1', testModeClassName)}>
      <HugeiconsIcon icon={TestTube01Icon} strokeWidth={2} aria-hidden />
      {t('testTransmission')}
    </Badge>
  )
}
