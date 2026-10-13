import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { aiDraftRequestedIn } from '@/components/mappings/ai-draft-run'
import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import { firstSearchParam } from '@/lib/search-params'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Mapping.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params, searchParams }: PageProps<'/mappings/[id]'>) {
  const [{ id }, query] = await Promise.all([params, searchParams])

  return (
    <MappingCanvasScreen
      id={id}
      aiDraftRequested={aiDraftRequestedIn(query)}
      field={firstSearchParam(query.field)}
    />
  )
}
