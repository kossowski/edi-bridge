'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { BackLink } from '@/components/detail-parts'
import { EditScreen } from '@/components/edit-screen'
import { FlowForm } from '@/components/flows/flow-form'
import { useFlowReferences } from '@/components/flows/flow-parts'
import { flowQuery } from '@/lib/api/queries'

export function NewFlowScreen() {
  const t = useTranslations()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/flows" label={t('Flow.back')} />
      <h1 className="text-2xl font-semibold tracking-tight">{t('FlowForm.createTitle')}</h1>
      <FlowForm />
    </div>
  )
}

export function EditFlowScreen({ id }: { id: string }) {
  const query = useQuery(flowQuery(id))
  const references = useFlowReferences()

  return (
    <EditScreen
      busy={references.isPending}
      detailHref={`/flows/${id}`}
      listHref="/flows"
      namespace="Flow"
      query={query}>
      {(flow) => <FlowForm flow={flow} />}
    </EditScreen>
  )
}
