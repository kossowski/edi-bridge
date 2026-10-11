import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { CanChangeOnly } from '@/components/session/can-change-only'
import { EditTradingPartnerScreen } from '@/components/trading-partners/trading-partner-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('TradingPartnerForm.editPageTitle')} · ${t('Shell.appName')}` },
  }
}

export default async function Page({ params }: PageProps<'/trading-partners/[id]/edit'>) {
  const { id } = await params

  return (
    <CanChangeOnly>
      <EditTradingPartnerScreen id={id} />
    </CanChangeOnly>
  )
}
