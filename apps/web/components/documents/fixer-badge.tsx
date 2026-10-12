'use client'

import { Refresh01Icon, UserIcon, UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { type Fixer } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'

export const fixerIcons: Record<Fixer, IconSvgElement> = {
  retry: Refresh01Icon,
  tradingPartner: UserMultiple02Icon,
  you: UserIcon,
}

export function FixerBadge({ fixer }: { fixer: Fixer }) {
  const t = useTranslations('Documents.whoFixes')

  return (
    <Badge variant="outline" className="border-destructive/30">
      <HugeiconsIcon icon={fixerIcons[fixer]} strokeWidth={2} aria-hidden />
      {t(fixer)}
    </Badge>
  )
}
