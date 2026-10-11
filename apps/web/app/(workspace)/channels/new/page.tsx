import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { NewChannelScreen } from '@/components/channels/channel-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('ChannelForm.createTitle')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return <NewChannelScreen />
}
