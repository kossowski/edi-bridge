import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { DocumentScreen } from '@/components/documents/document-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Document.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/documents/[id]'>) {
  const { id } = await params

  return <DocumentScreen id={id} />
}
