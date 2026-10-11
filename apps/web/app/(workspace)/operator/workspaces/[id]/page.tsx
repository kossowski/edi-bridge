import { getTranslations } from 'next-intl/server'

import type { Metadata } from 'next'

import { WorkspaceDetailScreen } from '@/components/operator/workspace-detail-screen'
import { OperatorOnly } from '@/components/session/operator-only'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('Operator.workspace.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/operator/workspaces/[id]'>) {
  const { id } = await params

  return (
    <OperatorOnly>
      <WorkspaceDetailScreen id={id} />
    </OperatorOnly>
  )
}
