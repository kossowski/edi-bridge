import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { NewCodeTranslationScreen } from '@/components/code-translations/new-code-translation-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('CodeTranslationNew.title')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return (
    <CanChangeOnly>
      <NewCodeTranslationScreen />
    </CanChangeOnly>
  )
}
