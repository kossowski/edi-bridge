import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { NewDocumentStructureScreen } from '@/components/document-structures/new-document-structure-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('DocumentStructureForm.createTitle')} · ${t('Shell.appName')}` },
  }
}

export default function Page() {
  return (
    <CanChangeOnly>
      <NewDocumentStructureScreen />
    </CanChangeOnly>
  )
}
