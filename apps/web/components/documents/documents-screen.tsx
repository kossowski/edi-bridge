'use client'

import { useTranslations } from 'next-intl'
import { Suspense } from 'react'

import { AppPage } from '@/components/app-page'
import { DocumentsInbox } from '@/components/documents/documents-inbox'
import { ManualSubmissionDialog } from '@/components/manual-submission/manual-submission-dialog'

export function DocumentsScreen() {
  const t = useTranslations('Sidebar.items')

  return (
    <AppPage
      changeActions={<ManualSubmissionDialog />}
      title={t('documents.label')}
      className="gap-4">
      <Suspense>
        <DocumentsInbox />
      </Suspense>
    </AppPage>
  )
}
