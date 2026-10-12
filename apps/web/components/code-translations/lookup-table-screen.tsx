'use client'

import { FileImportIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { tableDirection } from '@/components/code-translations/lookup-table-entries'
import {
  LookupTableValues,
  openMissingCodes,
  useFixedCodes,
} from '@/components/code-translations/lookup-table-values'
import { LoadFailure } from '@/components/detail-parts'
import { ImportCsvDialog } from '@/components/lookup-tables/import-csv-dialog'
import { useSession } from '@/hooks/use-session'
import { ApiError } from '@/lib/api/client'
import { lookupTableMissingCodesQuery, lookupTableQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { LookupTable } from '@edi-bridge/contracts'

function focusIfNothingFocused(heading: HTMLHeadingElement | null) {
  if (heading && (document.activeElement === null || document.activeElement === document.body)) {
    heading.focus()
  }
}

function Meta({ table }: { table: LookupTable }) {
  const t = useTranslations('CodeTranslations')

  return (
    <p>
      {t(`kinds.${table.kind}`)} &middot;{' '}
      {table.scope.kind === 'workspace'
        ? t('groups.workspace')
        : t('groups.tradingPartner', { name: table.scope.tradingPartner.name })}
    </p>
  )
}

export function LookupTableScreen({
  id,
  add,
  code,
  run,
}: {
  id: string
  add?: string | undefined
  code?: string | undefined
  run?: string | undefined
}) {
  const t = useTranslations('CodeTranslation')
  const tImport = useTranslations('LookupTable.import')
  const { data, error, isPending, refetch } = useQuery(lookupTableQuery(id))
  const missing = useQuery(lookupTableMissingCodesQuery(id))
  const session = useSession()
  const [importOpen, setImportOpen] = useState(false)
  const [imported, setImported] = useState('')
  const fixedCodes = useFixedCodes()
  const importButton = useRef<HTMLButtonElement>(null)
  const requestedCode = add ?? code

  return (
    <AppPage
      changeActions={
        data && (
          <Button ref={importButton} variant="outline" onClick={() => setImportOpen(true)}>
            <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} aria-hidden />
            {tImport('open')}
          </Button>
        )
      }
      meta={data && <Meta table={data} />}
      name={data?.name}
      titleRef={data && !session.isPending ? focusIfNothingFocused : undefined}>
      <p role="status" className="sr-only">
        {imported}
      </p>
      {isPending || session.isPending ? (
        <div aria-busy className="flex flex-col gap-6">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data ? (
        <>
          <LookupTableValues
            key={`${data.id}:${requestedCode ?? ''}`}
            canChange={session.canChange}
            fixed={fixedCodes.fixed}
            missing={missing}
            originRunId={run}
            requestedCode={requestedCode}
            table={data}
            onFixed={fixedCodes.record}
          />
          {session.canChange && (
            <ImportCsvDialog
              direction={tableDirection(data.uses)}
              finalFocus={importButton}
              open={importOpen}
              table={data}
              onImported={(saved, counts) => {
                fixedCodes.record(openMissingCodes(missing.data, data.entries) ?? [], saved, false)
                setImportOpen(false)
                setImported(tImport('applied', { added: counts.added, changed: counts.changed }))
              }}
              onOpenChange={setImportOpen}
            />
          )}
        </>
      ) : (
        <LoadFailure
          namespace="CodeTranslation"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
