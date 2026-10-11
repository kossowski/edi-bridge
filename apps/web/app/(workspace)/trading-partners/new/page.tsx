import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { CanChangeOnly } from '@/components/session/can-change-only'
import { NewTradingPartnerScreen } from '@/components/trading-partners/trading-partner-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('TradingPartnerForm.createTitle')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return (
    <CanChangeOnly>
      <NewTradingPartnerScreen />
    </CanChangeOnly>
  )
}
