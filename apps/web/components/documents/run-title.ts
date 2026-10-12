import { useTranslations } from 'next-intl'

import { usePlainNames } from '@/components/plain-names'
import { directionOf, type RunSummary } from '@edi-bridge/contracts'

type TitledRun = Pick<RunSummary, 'messageType' | 'tradingPartner' | 'businessReference'> &
  Partial<Pick<RunSummary, 'direction'>>

export function useRunTitle(run: TitledRun) {
  const t = useTranslations('Documents.row')
  const plainNames = usePlainNames()

  const values = {
    direction: run.direction ?? directionOf(run),
    messageType: plainNames.messageTypeName(run.messageType),
    tradingPartner: run.tradingPartner.name,
  }

  return run.businessReference === null
    ? t('titleWithoutReference', values)
    : t('title', { ...values, reference: run.businessReference })
}
