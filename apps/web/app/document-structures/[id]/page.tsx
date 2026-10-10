import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { DocumentStructureScreen } from '@/components/document-structures/document-structure-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('DocumentStructure.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/document-structures/[id]'>) {
  const { id } = await params

  return <DocumentStructureScreen id={id} />
}
