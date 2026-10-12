'use client'

import { CloudUploadIcon, WorkHistoryIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRef, useState } from 'react'

import {
  draftState,
  nextVersion,
  publishProblem,
  type VersionFacts,
} from '@/components/mappings/draft-state'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { ApiError, publishMappingDraft } from '@/lib/api/client'
import { mappingDraftQuery, storePublishedMappingVersion } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@edi-bridge/ui/components/dialog'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { MappingDraft } from '@edi-bridge/contracts'

export function DraftStateLabel({ draft, id }: { draft: VersionFacts; id?: string }) {
  const t = useTranslations('Mapping')
  const state = draftState(draft)
  const published = state.kind === 'published'

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Badge className="h-7 px-3 text-sm">{t('draft')}</Badge>
      <span
        id={id}
        className={cn(
          'inline-flex h-7 items-center gap-2 rounded-md px-2.5 font-medium ring-1',
          published
            ? 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900'
            : 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900',
        )}>
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full', published ? 'bg-emerald-500' : 'bg-amber-500')}
        />
        {state.kind === 'neverPublished'
          ? t('state.neverPublished')
          : t(`state.${state.kind}`, { version: state.version })}
      </span>
    </span>
  )
}

export function MappingVersionsLink({ mappingId }: { mappingId: string }) {
  const t = useTranslations('Mapping')

  return (
    <Link
      href={`/mappings/${mappingId}/versions`}
      className={buttonVariants({ variant: 'outline' })}>
      <HugeiconsIcon icon={WorkHistoryIcon} strokeWidth={2} aria-hidden />
      {t('versionsLink')}
    </Link>
  )
}

export function PublishDraft({
  draft,
  stateId,
  reviewHintId,
}: {
  draft: MappingDraft
  stateId?: string
  reviewHintId?: string
}) {
  const t = useTranslations('Mapping.publish')
  const queryClient = useQueryClient()
  const reviewOpen = draft.aiReview !== null
  const saving = useGraphSaveState(draft.mappingId) === 'saving'
  const [open, setOpen] = useState(false)
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const version = nextVersion(draft)

  const problemOf = (error: Error) =>
    publishProblem(error instanceof ApiError ? error.status : null)

  const publish = useMutation({
    mutationFn: () => publishMappingDraft(draft.mappingId, { changeNote: '', moveFlowIds: [] }),
    onSuccess: (summary) => {
      storePublishedMappingVersion(queryClient, summary)
      setPublishedVersion(summary.version)
      setOpen(false)
    },
    onError: (error) => {
      if (['noChanges', 'reviewOpen'].includes(problemOf(error))) {
        void queryClient.invalidateQueries({
          queryKey: mappingDraftQuery(draft.mappingId).queryKey,
        })
      }
    },
  })

  const justPublished =
    publishedVersion !== null &&
    publishedVersion === draft.latestVersion &&
    !draft.unpublishedChanges

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <p
        ref={doneRef}
        role="status"
        tabIndex={-1}
        className="absolute end-0 top-full mt-1 text-sm whitespace-nowrap text-emerald-800 outline-none empty:hidden dark:text-emerald-300">
        {justPublished && t('done', { version: publishedVersion })}
      </p>
      <MappingVersionsLink mappingId={draft.mappingId} />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (publish.isPending) {
            return
          }

          if (next) {
            publish.reset()
          }

          setOpen(next)
        }}>
        <DialogTrigger
          disabled={!draft.unpublishedChanges || saving || reviewOpen}
          render={<Button />}
          aria-describedby={
            [stateId, reviewOpen && reviewHintId].filter(Boolean).join(' ') || undefined
          }>
          <HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} aria-hidden />
          {t('button')}
        </DialogTrigger>
        <DialogContent
          closeLabel={t('close')}
          finalFocus={publish.isSuccess ? doneRef : true}
          showCloseButton={!publish.isPending}>
          <DialogHeader>
            <DialogTitle>{t('title', { version })}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {publish.isError && (
            <p role="alert" className="text-sm text-red-800 dark:text-red-300">
              {t(`problem.${problemOf(publish.error)}`)}
            </p>
          )}
          <DialogFooter>
            <DialogClose disabled={publish.isPending} render={<Button variant="outline" />}>
              {t('cancel')}
            </DialogClose>
            <Button
              disabled={publish.isPending}
              focusableWhenDisabled
              onClick={() => publish.mutate()}>
              {publish.isPending ? t('pending') : t('confirm', { version })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
