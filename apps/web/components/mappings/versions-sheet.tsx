'use client'

import { WorkHistoryIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Failure, Loading } from '@/components/detail-parts'
import { useRunTitle } from '@/components/documents/run-title'
import { EditorSheetContent } from '@/components/mappings/editor-sheet'
import { StateBadge } from '@/components/mappings/state-badge'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { comparisonHref, newestFirst } from '@/components/mappings/version-comparison'
import {
  failedDocumentsQuery,
  failedDocumentsShown,
  liveVersions,
} from '@/components/mappings/version-history'
import { usePlainNames } from '@/components/plain-names'
import { useCanChange } from '@/hooks/use-session'
import { isAiReviewOpen, restoreMappingVersion } from '@/lib/api/client'
import {
  mappingDraftQuery,
  mappingVersionsQuery,
  runsQuery,
  storeReplacedDraft,
} from '@/lib/api/queries'
import { documentHref } from '@/lib/navigation'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@edi-bridge/ui/components/alert-dialog'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Sheet, SheetTrigger } from '@edi-bridge/ui/components/sheet'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { MappingDraft, MappingVersionEntry, RunList, RunSummary } from '@edi-bridge/contracts'

const hidden = (chunks: ReactNode) => <span className="sr-only">{chunks}</span>

function useDateTime() {
  const format = useFormatter()

  return (iso: string) => (
    <time dateTime={iso}>
      {format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  )
}

function useLiveDescription(versions: ReadonlyArray<MappingVersionEntry> | undefined) {
  const t = useTranslations('Mapping.versions')
  const format = useFormatter()

  if (!versions) {
    return t('description')
  }

  const [latest] = newestFirst(versions)

  if (!latest) {
    return t('neverPublished')
  }

  const { live, stillInUse } = liveVersions(versions)

  if (!live) {
    return t('notLive', { version: latest.version })
  }

  return [
    t('live', { version: live.version, partners: format.list(live.partners) }),
    ...stillInUse.map(({ version, partners }) =>
      t('stillInUse', { version, partners: format.list(partners) }),
    ),
  ].join(' ')
}

function RestoreDialog({
  draft,
  version,
  returnFocus,
  onClose,
}: {
  draft: MappingDraft
  version: MappingVersionEntry | null
  returnFocus: () => HTMLElement | null
  onClose: () => void
}) {
  const t = useTranslations('Mapping.versions.restore')
  const queryClient = useQueryClient()
  const [lastShown, setLastShown] = useState(version)

  if (version !== null && version !== lastShown) {
    setLastShown(version)
  }

  const restore = useMutation({
    mutationFn: (chosen: MappingVersionEntry) => restoreMappingVersion(draft.mappingId, chosen.id),
    onSuccess: (restored, chosen) => {
      storeReplacedDraft(queryClient, restored)
      onClose()
      toast.success(t('done', { version: chosen.version }))
    },
    onError: (error) => {
      if (isAiReviewOpen(error)) {
        void queryClient.invalidateQueries({
          queryKey: mappingDraftQuery(draft.mappingId).queryKey,
        })
      }
    },
  })

  return (
    <AlertDialog
      open={version !== null}
      onOpenChange={(next) => {
        if (!next && !restore.isPending) {
          restore.reset()
          onClose()
        }
      }}>
      <AlertDialogContent
        finalFocus={() => returnFocus() ?? true}
        aria-busy={restore.isPending || undefined}>
        {lastShown && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('title', { version: lastShown.version })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('description', { version: lastShown.version })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {restore.isError && (
              <p role="alert" className="text-sm text-red-800 dark:text-red-300">
                {isAiReviewOpen(restore.error) ? t('problem.reviewOpen') : t('problem.failed')}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel
                aria-disabled={restore.isPending || undefined}
                className="aria-disabled:cursor-progress aria-disabled:opacity-50">
                {t('cancel')}
              </AlertDialogCancel>
              <Button
                disabled={restore.isPending}
                focusableWhenDisabled
                onClick={() => restore.mutate(lastShown)}>
                {restore.isPending ? t('pending') : t('confirm', { version: lastShown.version })}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

type VersionUse = 'live' | 'stillInUse' | 'unused'

function versionUse(version: MappingVersionEntry, live: number | undefined): VersionUse {
  if (version.version === live) {
    return 'live'
  }

  return version.flows.length > 0 ? 'stillInUse' : 'unused'
}

type RestoreState = 'hidden' | 'saving' | 'reviewOpen' | 'ready'

function restoreState(
  draft: MappingDraft,
  version: MappingVersionEntry,
  { canChange, saving }: { canChange: boolean; saving: boolean },
): RestoreState {
  const isCurrentDraft = version.version === draft.latestVersion && !draft.unpublishedChanges

  if (!canChange || isCurrentDraft) {
    return 'hidden'
  }

  if (draft.aiReview !== null) {
    return 'reviewOpen'
  }

  return saving ? 'saving' : 'ready'
}

function VersionItem({
  version,
  previous,
  use,
  restore,
  restoreHintId,
  onRestore,
}: {
  version: MappingVersionEntry
  previous: MappingVersionEntry | undefined
  use: VersionUse
  restore: RestoreState
  restoreHintId: string
  onRestore: (version: MappingVersionEntry, button: HTMLButtonElement) => void
}) {
  const t = useTranslations('Mapping.versions')
  const dateTime = useDateTime()

  return (
    <li className="relative flex flex-col gap-1.5">
      <span
        aria-hidden
        className={cn(
          'ring-background bg-muted-foreground/40 absolute -start-[1.875rem] top-1.5 size-3 rounded-full ring-4',
          use === 'live' && 'bg-emerald-600 dark:bg-emerald-400',
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{t('version', { version: version.version })}</h4>
        {use === 'live' && <StateBadge state="live">{t('liveMark')}</StateBadge>}
        {use === 'stillInUse' && <Badge variant="outline">{t('stillInUseMark')}</Badge>}
      </div>
      <p className="text-muted-foreground text-xs">
        {t.rich('published', {
          name: version.publishedBy.name,
          time: () => dateTime(version.publishedAt),
        })}
      </p>
      {version.changeNote === null ? (
        <p className="text-muted-foreground text-sm italic">{t('noNote')}</p>
      ) : (
        <p className="text-sm break-words">{version.changeNote}</p>
      )}
      {use === 'unused' ? (
        <p className="text-muted-foreground text-xs">{t('unused')}</p>
      ) : (
        <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          <p>{t('usedBy', { count: version.flows.length })}</p>
          <ul className="flex flex-col gap-0.5">
            {version.flows.map((flow) => (
              <li key={flow.id} className="break-words">
                {t('route', { route: flow.name, partner: flow.tradingPartner.name })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(previous || restore !== 'hidden') && (
        <div className="flex flex-wrap gap-2 pt-1">
          {previous && (
            <Link
              href={comparisonHref(version.mappingId, { from: previous.id, to: version.id })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t.rich('compare', {
                previous: previous.version,
                version: version.version,
                hidden,
              })}
            </Link>
          )}
          {restore !== 'hidden' && (
            <Button
              disabled={restore !== 'ready'}
              focusableWhenDisabled
              size="sm"
              variant="ghost"
              aria-describedby={restore === 'reviewOpen' ? restoreHintId : undefined}
              onClick={(event) => onRestore(version, event.currentTarget)}>
              {t.rich('restore.button', { version: version.version, hidden })}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function VersionTimeline({
  draft,
  versions,
}: {
  draft: MappingDraft
  versions: UseQueryResult<MappingVersionEntry[]>
}) {
  const t = useTranslations('Mapping.versions')
  const canChange = useCanChange()
  const saving = useGraphSaveState(draft.mappingId) === 'saving'
  const restoreHintId = useId()
  const [restoring, setRestoring] = useState<MappingVersionEntry | null>(null)
  const restoreButton = useRef<HTMLButtonElement | null>(null)

  if (versions.isError) {
    return (
      <Failure
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        notFound={null}
        onRetry={() => void versions.refetch()}
      />
    )
  }

  if (!versions.data) {
    return <Loading label={t('loading')} rowClassName="h-20" rows={4} />
  }

  const ordered = newestFirst(versions.data)

  if (ordered.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
        {t('empty')}
      </p>
    )
  }

  const live = liveVersions(ordered).live?.version

  return (
    <>
      {canChange && draft.aiReview !== null && (
        <p id={restoreHintId} className="text-muted-foreground text-sm">
          {t('restore.reviewOpen')}
        </p>
      )}
      <ol className="ms-2 flex flex-col gap-5 border-s ps-6">
        {ordered.map((version, index) => (
          <VersionItem
            key={version.id}
            previous={ordered[index + 1]}
            restore={restoreState(draft, version, { canChange, saving })}
            restoreHintId={restoreHintId}
            use={versionUse(version, live)}
            version={version}
            onRestore={(chosen, button) => {
              restoreButton.current = button
              setRestoring(chosen)
            }}
          />
        ))}
      </ol>
      {canChange && (
        <RestoreDialog
          draft={draft}
          returnFocus={() => (restoreButton.current?.isConnected ? restoreButton.current : null)}
          version={restoring}
          onClose={() => setRestoring(null)}
        />
      )}
    </>
  )
}

function FailedDocument({ run }: { run: RunSummary }) {
  const t = useTranslations('Mapping.versions.failed')
  const title = useRunTitle(run)
  const plainNames = usePlainNames()
  const dateTime = useDateTime()

  return (
    <li>
      <Link
        href={documentHref(run.id)}
        className="hover:bg-muted/50 focus-visible:ring-ring/50 flex flex-col gap-0.5 px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-inset">
        <span className="font-medium underline-offset-4 hover:underline">{title}</span>
        <span className="text-muted-foreground text-xs">
          {run.failureStage === null
            ? dateTime(run.receivedAt)
            : t.rich('detail', {
                stage: plainNames.failureStageTitle(run.failureStage),
                time: () => dateTime(run.receivedAt),
              })}
        </span>
      </Link>
    </li>
  )
}

function FailedDocumentList({ runs }: { runs: UseQueryResult<RunList> }) {
  const t = useTranslations('Mapping.versions.failed')

  if (runs.isError) {
    return (
      <Failure
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        notFound={null}
        onRetry={() => void runs.refetch()}
      />
    )
  }

  if (!runs.data) {
    return <Loading label={t('loading')} rowClassName="h-12" rows={3} />
  }

  if (runs.data.runs.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {runs.data.runs.map((run) => (
          <FailedDocument key={run.id} run={run} />
        ))}
      </ul>
      {runs.data.total > runs.data.runs.length && (
        <p className="text-muted-foreground text-xs">
          {t('more', { shown: failedDocumentsShown, total: runs.data.total })}
        </p>
      )}
    </>
  )
}

export function VersionsSheet({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.versions')
  const [open, setOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(() => new Date())
  const versionsHeadingId = useId()
  const failedHeadingId = useId()

  const versions = useQuery({ ...mappingVersionsQuery(draft.mappingId), enabled: open })

  const failedRuns = useQuery({
    ...runsQuery(failedDocumentsQuery(draft.mappingId, openedAt)),
    enabled: open,
  })

  const description = useLiveDescription(versions.data)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpenedAt(new Date())
        }

        setOpen(next)
      }}>
      <ToolbarAction
        icon={<HugeiconsIcon icon={WorkHistoryIcon} strokeWidth={2} aria-hidden />}
        label={t('title')}
        render={<SheetTrigger render={<Button variant="outline" />} />}
      />
      <EditorSheetContent
        bodyClassName="gap-8"
        closeLabel={t('close')}
        description={description}
        title={t('title')}
        className="data-[side=right]:sm:max-w-md">
        <section aria-labelledby={versionsHeadingId} className="flex flex-col gap-3">
          <h3 id={versionsHeadingId} className="font-semibold">
            {t('heading')}
          </h3>
          <VersionTimeline draft={draft} versions={versions} />
        </section>
        <section aria-labelledby={failedHeadingId} className="flex flex-col gap-2">
          <h3 id={failedHeadingId} className="font-semibold">
            {t('failed.title')}
          </h3>
          <FailedDocumentList runs={failedRuns} />
        </section>
      </EditorSheetContent>
    </Sheet>
  )
}
