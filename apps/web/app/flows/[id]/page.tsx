import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { FlowDetailScreen } from '@/components/flows/flow-detail-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Flow.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/flows/[id]'>) {
  const { id } = await params

  return <FlowDetailScreen id={id} />
}
