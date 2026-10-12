'use client'

import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'
import { RunFilters } from '@/components/runs/run-filters'
import { RunsTable } from '@/components/runs/runs-table'

export function RunsScreen() {
  const t = useTranslations('Sidebar.items')

  return (
    <AppPage
      changeActions={<ManualSubmissionDialog />}
      title={t('documents.label')}
      className="gap-4">
      <RunFilters />
      <RunsTable />
    </AppPage>
  )
}
