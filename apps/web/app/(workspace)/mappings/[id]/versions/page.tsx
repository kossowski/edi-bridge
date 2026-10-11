import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { MappingVersionsScreen } from '@/components/mappings/mapping-versions-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('MappingVersions.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/mappings/[id]/versions'>) {
  const { id } = await params

  return <MappingVersionsScreen id={id} />
}
