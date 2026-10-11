import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { EditFlowScreen } from '@/components/flows/flow-form-screen'
import { CanChangeOnly } from '@/components/session/can-change-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return {
    title: { absolute: `${t('FlowForm.editPageTitle')} · ${t('Shell.appName')}` },
  }
}

export default async function Page({ params }: PageProps<'/flows/[id]/edit'>) {
  const { id } = await params

  return (
    <CanChangeOnly>
      <EditFlowScreen id={id} />
    </CanChangeOnly>
  )
}
