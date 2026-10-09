import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { NewFlowScreen } from '@/components/flows/flow-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('FlowForm.createTitle')} · ${t('Shell.appName')}` } }
}

export default function Page() {
  return <NewFlowScreen />
}
