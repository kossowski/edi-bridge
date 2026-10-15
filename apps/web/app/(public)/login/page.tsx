import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { LoginScreen } from '@/components/session/login-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Login.metaTitle')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return <LoginScreen />
}
