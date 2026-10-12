import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { CanChangeOnly } from '@/components/session/can-change-only'
import { PartnerWizard } from '@/components/trading-partners/partner-wizard'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('PartnerWizard.title')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return (
    <CanChangeOnly>
      <PartnerWizard />
    </CanChangeOnly>
  )
}
