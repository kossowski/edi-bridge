'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { WorkspaceKind } from '@edi-bridge/contracts'

export function WorkspaceKindBadge({ kind }: { kind: WorkspaceKind }) {
  const t = useTranslations('Operator.kind')

  return (
    <Badge
      variant="outline"
      className={cn(
        kind === 'showcase' && 'bg-sky-500/10 text-sky-800 dark:text-sky-300',
        kind === 'sandbox' && 'bg-violet-500/10 text-violet-800 dark:text-violet-300',
      )}>
      {t(kind)}
    </Badge>
  )
}
