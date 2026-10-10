'use client'

import { CloudUploadIcon, WorkHistoryIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRef, useState } from 'react'

import { draftState, nextVersion, publishProblem } from '@/components/mappings/draft-state'
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

import type { MappingDraft } from '@edi-bridge/contracts'

type VersionFacts = Pick<MappingDraft, 'latestVersion' | 'unpublishedChanges'>

const dotTones = {
  neverPublished: 'bg-amber-500',
  unpublishedChanges: 'bg-amber-500',
  published: 'bg-emerald-500',
} as const

export function DraftStateLabel({ draft }: { draft: VersionFacts }) {
  const t = useTranslations('Mapping')
  const state = draftState(draft)

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="outline">{t('draft')}</Badge>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`size-2 rounded-full ${dotTones[state.kind]}`} />
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

export function PublishDraft({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.publish')
  const queryClient = useQueryClient()
  const saving = useGraphSaveState(draft.mappingId) === 'saving'
  const [open, setOpen] = useState(false)
  const [published, setPublished] = useState<number | null>(null)
  const done = useRef<HTMLParagraphElement>(null)
  const version = nextVersion(draft)

  const problemOf = (error: Error) =>
    publishProblem(error instanceof ApiError ? error.status : null)

  const publish = useMutation({
    mutationFn: () => publishMappingDraft(draft.mappingId),
    onSuccess: (summary) => {
      storePublishedMappingVersion(queryClient, summary)
      setPublished(summary.version)
      setOpen(false)
    },
    onError: (error) => {
      if (problemOf(error) === 'noChanges') {
        void queryClient.invalidateQueries({
          queryKey: mappingDraftQuery(draft.mappingId).queryKey,
        })
      }
    },
  })

  const justPublished =
    published !== null && published === draft.latestVersion && !draft.unpublishedChanges

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p
        ref={done}
        role="status"
        tabIndex={-1}
        className="text-sm text-emerald-800 outline-none empty:hidden dark:text-emerald-300">
        {justPublished && t('done', { version: published })}
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
        <DialogTrigger disabled={!draft.unpublishedChanges || saving} render={<Button />}>
          <HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} aria-hidden />
          {t('button')}
        </DialogTrigger>
        <DialogContent
          closeLabel={t('close')}
          finalFocus={publish.isSuccess ? done : true}
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
            <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? t('pending') : t('confirm', { version })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
