import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { InterchangeScreen } from '@/components/interchanges/interchange-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Interchange.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/interchanges/[id]'>) {
  const { id } = await params

  return <InterchangeScreen id={id} />
}
