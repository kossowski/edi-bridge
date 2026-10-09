'use client'

import { useTranslations } from 'next-intl'

import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'
import { RunFilters } from '@/components/runs/run-filters'
import { RunsTable } from '@/components/runs/runs-table'

export function RunsScreen() {
  const t = useTranslations('Navigation')

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('runs')}</h1>
        <ManualSubmissionDialog />
      </div>
      <RunFilters />
      <RunsTable />
    </div>
  )
}
