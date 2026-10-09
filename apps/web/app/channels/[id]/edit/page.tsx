import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { EditChannelScreen } from '@/components/channels/channel-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('ChannelForm.editPageTitle')} · ${t('Shell.appName')}` },
  }
}

export default async function Page({ params }: PageProps<'/channels/[id]/edit'>) {
  const { id } = await params

  return <EditChannelScreen id={id} />
}
