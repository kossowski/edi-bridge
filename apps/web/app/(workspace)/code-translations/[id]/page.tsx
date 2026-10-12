import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { LookupTableEditorScreen } from '@/components/lookup-tables/lookup-table-editor-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('LookupTable.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/code-translations/[id]'>) {
  const { id } = await params

  return <LookupTableEditorScreen id={id} />
}
