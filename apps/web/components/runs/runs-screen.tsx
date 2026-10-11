'use client'

import { useTranslations } from 'next-intl'

import { AppPage } from '@/components/app-page'
import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'
import { RunFilters } from '@/components/runs/run-filters'
import { RunsTable } from '@/components/runs/runs-table'
import { useCanChange } from '@/hooks/use-session'

export function RunsScreen() {
  const t = useTranslations('Navigation')
  const canChange = useCanChange()

  return (
    <AppPage actions={canChange && <ManualSubmissionDialog />} title={t('runs')}>
      <RunFilters />
      <RunsTable />
    </AppPage>
  )
}
