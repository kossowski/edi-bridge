'use client'

import { useTranslations } from 'next-intl'

import { useSession } from '@/hooks/use-session'
import { Badge } from '@edi-bridge/ui/components/badge'

export function ViewOnlyBadge() {
  const t = useTranslations('Shell.session')
  const { viewer } = useSession()

  if (!viewer) {
    return null
  }

  return (
    <Badge variant="secondary" className="shrink-0">
      {t('viewOnly')}
      <span className="sr-only">: {t('viewOnlyDescription')}</span>
    </Badge>
  )
}
