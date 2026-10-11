import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { NewChannelScreen } from '@/components/channels/channel-form-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('ChannelForm.createTitle')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return (
    <CanChangeOnly>
      <NewChannelScreen />
    </CanChangeOnly>
  )
}
