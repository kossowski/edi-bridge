import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { RunDetailScreen } from '@/components/runs/run-detail-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('RunDetail.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/runs/[id]'>) {
  const { id } = await params

  return <RunDetailScreen id={id} />
}
