import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { isAiDraftStart } from '@/components/mappings/ai-draft-run'
import { MappingCanvasScreen } from '@/components/mappings/mapping-canvas-screen'
import { firstSearchParam } from '@/lib/search-params'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Mapping.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params, searchParams }: PageProps<'/mappings/[id]'>) {
  const [{ id }, { field, 'ai-draft': aiDraft }] = await Promise.all([params, searchParams])

  return (
    <MappingCanvasScreen
      id={id}
      aiDraftStart={isAiDraftStart(firstSearchParam(aiDraft))}
      field={firstSearchParam(field)}
    />
  )
}
