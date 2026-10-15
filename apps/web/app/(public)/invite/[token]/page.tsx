import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { InviteScreen } from '@/components/session/invite-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Invite.metaTitle')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params

  return <InviteScreen token={token} />
}
