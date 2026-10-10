'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { scopeIcons } from '@/components/lookup-tables/lookup-table-scope'

import type { LookupTableScope } from '@edi-bridge/contracts'

export function ScopeLabel({ scope }: { scope: LookupTableScope }) {
  const t = useTranslations('LookupTables.scope')

  return (
    <span className="flex items-center gap-1.5">
      <HugeiconsIcon
        icon={scopeIcons[scope.kind]}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      {scope.kind === 'workspace' ? t('workspace') : scope.tradingPartner.name}
    </span>
  )
}
