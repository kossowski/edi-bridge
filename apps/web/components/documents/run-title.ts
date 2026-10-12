import { useTranslations } from 'next-intl'

import { usePlainNames } from '@/components/plain-names'

import type { RunSummary } from '@edi-bridge/contracts'

export function useRunTitle(run: RunSummary) {
  const t = useTranslations('Documents.row')
  const plainNames = usePlainNames()

  const values = {
    direction: run.direction,
    messageType: plainNames.messageTypeName(run.messageType),
    tradingPartner: run.tradingPartner.name,
  }

  return run.businessReference === null
    ? t('titleWithoutReference', values)
    : t('title', { ...values, reference: run.businessReference })
}
