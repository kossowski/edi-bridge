import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Mapping.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/mappings/[id]'>) {
  const { id } = await params

  return <MappingCanvasScreen id={id} />
}
