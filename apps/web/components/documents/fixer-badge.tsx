'use client'

import {
  Refresh01Icon,
  UserIcon,
  UserMultiple02Icon,
  Wrench01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { type Fixer, type ProblemReason } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'

// What the screens tell the user to do first. An incomplete setup is fixed by a Retry, but trying
// again only works once the setup is complete, so the screens lead with completing it.
export type ShownFixer = Fixer | 'setup'

export function shownFixer(fixer: Fixer, reason: ProblemReason | undefined): ShownFixer {
  return fixer === 'retry' && reason === 'incompleteSetup' ? 'setup' : fixer
}

export const fixerIcons: Record<ShownFixer, IconSvgElement> = {
  retry: Refresh01Icon,
  setup: Wrench01Icon,
  tradingPartner: UserMultiple02Icon,
  you: UserIcon,
}

export function FixerBadge({ fixer }: { fixer: ShownFixer }) {
  const t = useTranslations('Documents.whoFixes')

  return (
    <Badge variant="outline" className="border-destructive/30">
      <HugeiconsIcon icon={fixerIcons[fixer]} strokeWidth={2} aria-hidden />
      {t(fixer)}
    </Badge>
  )
}
