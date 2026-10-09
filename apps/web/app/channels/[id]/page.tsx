import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { ChannelDetailScreen } from '@/components/channels/channel-detail-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Channel.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/channels/[id]'>) {
  const { id } = await params

  return <ChannelDetailScreen id={id} />
}
