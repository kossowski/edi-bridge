import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { EditChannelScreen } from '@/components/channels/channel-form-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('ChannelForm.editPageTitle')} · ${t('Shell.appName')}` },
  }
}

export default async function Page({ params }: PageProps<'/channels/[id]/edit'>) {
  const { id } = await params

  return (
    <CanChangeOnly>
      <EditChannelScreen id={id} />
    </CanChangeOnly>
  )
}
