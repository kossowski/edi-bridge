import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { TradingPartnerDetailScreen } from '@/components/trading-partners/trading-partner-detail-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('TradingPartner.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/trading-partners/[id]'>) {
  const { id } = await params

  return <TradingPartnerDetailScreen id={id} />
}
