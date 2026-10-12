'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { EditScreen } from '@/components/edit-screen'
import { FlowForm } from '@/components/flows/flow-form'
import { useFlowReferences } from '@/components/flows/flow-parts'
import { flowQuery } from '@/lib/api/queries'

export function NewFlowScreen() {
  const t = useTranslations()

  return (
    <AppPage title={t('FlowForm.createTitle')}>
      <FlowForm />
    </AppPage>
  )
}

export function EditFlowScreen({ id }: { id: string }) {
  const query = useQuery(flowQuery(id))
  const references = useFlowReferences()

  return (
    <EditScreen busy={references.isPending} namespace="Flow" query={query}>
      {(flow) => <FlowForm flow={flow} />}
    </EditScreen>
  )
}
