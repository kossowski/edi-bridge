'use client'

import { GitCompareIcon, WorkHistoryIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import { AppPage } from '@/components/app-page'
import { linkClass, LoadFailure } from '@/components/detail-parts'
import { ListTable } from '@/components/list-screen'
import { DraftStateLabel } from '@/components/mappings/publish-draft'
import { comparisonHref, newestFirst } from '@/components/mappings/version-comparison'
import { ApiError } from '@/lib/api/client'
import { mappingDraftQuery, mappingVersionsQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { MappingDraft, MappingVersionSummary } from '@edi-bridge/contracts'

const columns = ['version', 'publishedAt'] as const

function VersionRow({
  version,
  previous,
  latest,
}: {
  version: MappingVersionSummary
  previous: MappingVersionSummary | undefined
  latest: boolean
}) {
  const t = useTranslations('MappingVersions')
  const format = useFormatter()

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="flex flex-col items-start gap-1">
          <span className="inline-flex items-center gap-2 font-medium">
            {t('version', { version: version.version })}
            {latest && <Badge variant="secondary">{t('latest')}</Badge>}
          </span>
          {previous && (
            <Link
              href={comparisonHref(version.mappingId, { from: previous.id, to: version.id })}
              className={`${linkClass} text-sm`}>
              {t('compareWith', { version: previous.version })}
            </Link>
          )}
        </div>
      </TableCell>
      <TableCell>
        <time dateTime={version.publishedAt}>
          {format.dateTime(new Date(version.publishedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </time>
      </TableCell>
    </TableRow>
  )
}

function DraftSummary({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('MappingVersions')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <DraftStateLabel draft={draft} />
      <Link href={`/mappings/${draft.mappingId}`} className={`${linkClass} text-sm`}>
        {t('openDraft')}
      </Link>
    </div>
  )
}

function VersionList({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('MappingVersions')
  const versions = useQuery(mappingVersionsQuery(draft.mappingId))
  const ordered = versions.data && newestFirst(versions.data)

  return (
    <>
      <DraftSummary draft={draft} />
      <ListTable
        columns={columns.map((key) => ({ key, label: t(`columns.${key}`) }))}
        emptyIcon={WorkHistoryIcon}
        matches={(version, term) => String(version.version).includes(term)}
        pending={false}
        query={{ ...versions, data: ordered }}
        row={(version) => (
          <VersionRow
            key={version.id}
            latest={version.id === ordered?.[0]?.id}
            previous={ordered?.find((other) => other.version < version.version)}
            version={version}
          />
        )}
        t={t}
      />
    </>
  )
}

function VersionsLoading() {
  const t = useTranslations('MappingVersions')

  return (
    <div aria-busy className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function MappingVersionsScreen({ id }: { id: string }) {
  const t = useTranslations('MappingVersions')
  const { data, error, isPending, refetch } = useQuery(mappingDraftQuery(id))
  const versions = useQuery({ ...mappingVersionsQuery(id), enabled: data !== undefined })

  return (
    <AppPage
      actions={
        (versions.data?.length ?? 0) > 1 && (
          <Link href={comparisonHref(id)} className={buttonVariants({ variant: 'outline' })}>
            <HugeiconsIcon icon={GitCompareIcon} strokeWidth={2} aria-hidden />
            {t('compare')}
          </Link>
        )
      }
      name={data?.name}
      title={t('title')}>
      {isPending ? (
        <VersionsLoading />
      ) : data ? (
        <VersionList draft={data} />
      ) : (
        <LoadFailure
          namespace="Mapping"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
