'use client'

import { WorkHistoryIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Sheet, SheetTrigger } from '@edi-bridge/ui/components/sheet'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { MappingDraft, MappingVersionEntry, RunSummary } from '@edi-bridge/contracts'

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

  const live = liveVersions(versions)

  if (live.length === 0) {
    return t('notLive', { version: latest.version })
  }

  return live
    .map(({ version, partners }) => t('live', { version, partners: format.list(partners) }))
    .join(' ')
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
  // The dialog keeps its text while it fades out.
  const [shown, setShown] = useState(version)

  if (version !== null && version !== shown) {
    setShown(version)
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
        {shown && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('title', { version: shown.version })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('description', { version: shown.version })}
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
                onClick={() => restore.mutate(shown)}>
                {restore.isPending ? t('pending') : t('confirm', { version: shown.version })}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function VersionItem({
  version,
  previous,
  restorable,
  restoreBlocked,
  restoreHintId,
  onRestore,
}: {
  version: MappingVersionEntry
  previous: MappingVersionEntry | undefined
  restorable: boolean
  restoreBlocked: boolean
  restoreHintId: string | undefined
  onRestore: (version: MappingVersionEntry, button: HTMLButtonElement) => void
}) {
  const t = useTranslations('Mapping.versions')
  const dateTime = useDateTime()
  const live = version.flows.length > 0

  return (
    <li className="relative flex flex-col gap-1.5">
      <span
        aria-hidden
        className={cn(
          'ring-background bg-muted-foreground/40 absolute -start-[1.875rem] top-1.5 size-3 rounded-full ring-4',
          live && 'bg-emerald-600 dark:bg-emerald-400',
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{t('version', { version: version.version })}</h4>
        {live && <StateBadge state="live">{t('liveMark')}</StateBadge>}
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
      {live ? (
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
      ) : (
        <p className="text-muted-foreground text-xs">{t('unused')}</p>
      )}
      {(previous || restorable) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {previous && (
            <Link
              href={comparisonHref(version.mappingId, { from: previous.id, to: version.id })}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t.rich('compare', { version: previous.version, hidden })}
            </Link>
          )}
          {restorable && (
            <Button
              disabled={restoreBlocked}
              focusableWhenDisabled
              size="sm"
              variant="ghost"
              aria-describedby={restoreBlocked ? restoreHintId : undefined}
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
  onRetry,
}: {
  draft: MappingDraft
  versions: { data: MappingVersionEntry[] | undefined; isError: boolean }
  onRetry: () => void
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
        onRetry={onRetry}
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

  const reviewOpen = draft.aiReview !== null

  return (
    <>
      {canChange && reviewOpen && (
        <p id={restoreHintId} className="text-muted-foreground text-sm">
          {t('restore.reviewOpen')}
        </p>
      )}
      <ol className="ms-2 flex flex-col gap-5 border-s ps-6">
        {ordered.map((version, index) => (
          <VersionItem
            key={version.id}
            previous={ordered[index + 1]}
            restorable={
              canChange && !(version.version === draft.latestVersion && !draft.unpublishedChanges)
            }
            restoreBlocked={reviewOpen || saving}
            restoreHintId={reviewOpen ? restoreHintId : undefined}
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

function FailedDocuments({
  mappingId,
  since,
  open,
}: {
  mappingId: string
  since: Date
  open: boolean
}) {
  const t = useTranslations('Mapping.versions.failed')
  const headingId = useId()
  const runs = useQuery({ ...runsQuery(failedDocumentsQuery(mappingId, since)), enabled: open })

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-semibold">
        {t('title')}
      </h3>
      {runs.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {t('error')}
          </p>
          <Button size="sm" variant="outline" onClick={() => void runs.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : !runs.data ? (
        <Loading label={t('loading')} rowClassName="h-12" rows={3} />
      ) : runs.data.runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
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
      )}
    </section>
  )
}

export function VersionsSheet({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.versions')
  const [open, setOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(() => new Date())
  const headingId = useId()

  const versions = useQuery({ ...mappingVersionsQuery(draft.mappingId), enabled: open })
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
        <section aria-labelledby={headingId} className="flex flex-col gap-3">
          <h3 id={headingId} className="font-semibold">
            {t('heading')}
          </h3>
          <VersionTimeline
            draft={draft}
            versions={versions}
            onRetry={() => void versions.refetch()}
          />
        </section>
        <FailedDocuments mappingId={draft.mappingId} open={open} since={openedAt} />
      </EditorSheetContent>
    </Sheet>
  )
}
