import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { EditFlowScreen } from '@/components/flows/flow-form-screen'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('FlowForm.editPageTitle')} · ${t('Shell.appName')}` },
  }
}

export default async function Page({ params }: PageProps<'/flows/[id]/edit'>) {
  const { id } = await params

  return <EditFlowScreen id={id} />
}
