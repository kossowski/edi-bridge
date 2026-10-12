'use client'

import { CloudUploadIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'

import { describedBy, FormField } from '@/components/form-field'
import {
  draftState,
  nextVersion,
  publishProblem,
  type VersionFacts,
} from '@/components/mappings/draft-state'
import { changeNoteProblem, chosenFlowIds } from '@/components/mappings/publish-plan'
import { StateBadge } from '@/components/mappings/state-badge'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { type FlowInUse, flowsInUse } from '@/components/mappings/version-history'
import { ApiError, publishMappingDraft } from '@/lib/api/client'
import {
  mappingDraftQuery,
  mappingVersionsQuery,
  storePublishedMappingVersion,
} from '@/lib/api/queries'
import { maxChangeNoteLength, type MappingDraft } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
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
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { Textarea } from '@edi-bridge/ui/components/textarea'

export function DraftStateLabel({ draft, id }: { draft: VersionFacts; id?: string }) {
  const t = useTranslations('Mapping')
  const state = draftState(draft)

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Badge className="h-7 px-3 text-sm">{t('draft')}</Badge>
      <StateBadge
        id={id}
        focusable
        state={state.kind === 'published' ? 'live' : 'draft'}
        className="h-7 gap-2 px-3 text-sm [&>svg]:size-4!">
        {state.kind === 'neverPublished'
          ? t('state.neverPublished')
          : t(`state.${state.kind}`, { version: state.version })}
      </StateBadge>
    </span>
  )
}

const flowNamesShown = 3

type FlowList =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; flows: ReadonlyArray<FlowInUse> }

function KeptFlows({ kept, version }: { kept: ReadonlyArray<FlowInUse>; version: number }) {
  const t = useTranslations('Mapping.publish.routes')
  const format = useFormatter()

  return (
    <p className="text-muted-foreground text-sm">
      {kept.length > flowNamesShown
        ? t('keepMany', { count: kept.length })
        : t('keep', {
            count: kept.length,
            version,
            routes: format.list(
              kept.map(({ name, partner }) => t('keepRoute', { route: name, partner })),
            ),
          })}
    </p>
  )
}

function FlowsToMove({
  list,
  version,
  chosen,
  disabled,
  loadingId,
  onChange,
}: {
  list: FlowList
  version: number
  chosen: ReadonlySet<string>
  disabled: boolean
  loadingId: string
  onChange: (id: string, checked: boolean) => void
}) {
  const t = useTranslations('Mapping.publish.routes')
  const descriptionId = useId()

  if (list.status === 'loading') {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <p id={loadingId} role="status" className="text-muted-foreground text-sm">
          {t('loading')}
        </p>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-red-800 dark:text-red-300">{t('error')}</p>
        <Button size="sm" variant="outline" onClick={list.retry}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (list.flows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t('legend')}</legend>
      {list.flows.map((flow) => (
        <div
          key={flow.id}
          className="has-data-checked:border-primary has-data-checked:bg-muted/50 relative flex flex-col gap-0.5 rounded-lg border p-3">
          <label className="flex cursor-pointer items-start gap-3 text-sm font-medium break-words after:absolute after:inset-0">
            <Checkbox
              checked={chosen.has(flow.id)}
              disabled={disabled}
              aria-describedby={`${descriptionId}-${flow.id}`}
              className="mt-0.5"
              onCheckedChange={(checked) => onChange(flow.id, checked)}
            />
            <span className="min-w-0">
              {t('move', { route: flow.name, partner: flow.partner, version })}
            </span>
          </label>
          <span id={`${descriptionId}-${flow.id}`} className="text-muted-foreground ps-7 text-sm">
            {t('current', { version: flow.version })}
          </span>
        </div>
      ))}
      <KeptFlows kept={list.flows.filter(({ id }) => !chosen.has(id))} version={version} />
    </fieldset>
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
  const [note, setNote] = useState('')
  const [noteChecked, setNoteChecked] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const noteId = useId()
  const version = nextVersion(draft)
  const published = draft.latestVersion !== null

  const loadingId = useId()
  const versionsQuery = mappingVersionsQuery(draft.mappingId)

  const history = useQuery({ ...versionsQuery, enabled: open && published })

  const flowList: FlowList = !published
    ? { status: 'ready', flows: [] }
    : history.isPending || (history.isError && history.isFetching)
      ? { status: 'loading' }
      : history.isError
        ? { status: 'error', retry: () => void history.refetch() }
        : { status: 'ready', flows: flowsInUse(history.data) }

  const flowsLoading = flowList.status === 'loading'

  const problemOf = (error: Error) =>
    publishProblem(error instanceof ApiError ? error.status : null)

  const publish = useMutation({
    mutationFn: (moveFlowIds: string[]) =>
      publishMappingDraft(draft.mappingId, { changeNote: note.trim(), moveFlowIds }),
    onSuccess: (summary, moveFlowIds) => {
      storePublishedMappingVersion(queryClient, summary)
      setOpen(false)
      toast.success(
        moveFlowIds.length > 0
          ? t('doneMoved', { version: summary.version, count: moveFlowIds.length })
          : t('done', { version: summary.version }),
      )
    },
    onError: (error) => {
      if (['noChanges', 'reviewOpen'].includes(problemOf(error))) {
        void queryClient.invalidateQueries({
          queryKey: mappingDraftQuery(draft.mappingId).queryKey,
        })
      }
    },
  })

  const noteProblem = changeNoteProblem(note)
  const shownNoteProblem = noteProblem === 'tooLong' || noteChecked ? noteProblem : null

  const noteError =
    shownNoteProblem &&
    t(`note.${shownNoteProblem}`, { max: maxChangeNoteLength, length: note.trim().length })

  function confirm() {
    if (flowsLoading) {
      return
    }

    if (noteProblem) {
      flushSync(() => setNoteChecked(true))
      noteRef.current?.focus()

      return
    }

    publish.mutate(flowList.status === 'ready' ? chosenFlowIds(flowList.flows, chosen) : [])
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (publish.isPending) {
          return
        }

        if (next) {
          void queryClient.resetQueries({ queryKey: versionsQuery.queryKey })
          publish.reset()
          setNote('')
          setNoteChecked(false)
          setChosen(new Set())
        }

        setOpen(next)
      }}>
      <ToolbarAction
        icon={<HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} aria-hidden />}
        label={t('button')}
        render={
          <DialogTrigger
            disabled={!draft.unpublishedChanges || saving || reviewOpen}
            render={<Button />}
            aria-describedby={
              [stateId, reviewOpen && reviewHintId].filter(Boolean).join(' ') || undefined
            }
          />
        }
      />
      <DialogContent
        closeLabel={t('close')}
        finalFocus={
          publish.isSuccess && stateId ? () => document.getElementById(stateId) ?? true : true
        }
        initialFocus={noteRef}
        showCloseButton={!publish.isPending}
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="pe-8">
          <DialogTitle>{t('title', { version })}</DialogTitle>
          <DialogDescription>{t('description', { version })}</DialogDescription>
        </DialogHeader>
        <form
          id={`${noteId}-form`}
          noValidate
          className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            confirm()
          }}>
          <FormField
            id={noteId}
            description={t('note.description', { max: maxChangeNoteLength })}
            error={noteError}
            label={
              <label htmlFor={noteId} className="text-sm font-medium">
                {t('note.label')}
              </label>
            }>
            <Textarea
              id={noteId}
              placeholder={t('note.placeholder')}
              readOnly={publish.isPending}
              ref={noteRef}
              required
              rows={3}
              value={note}
              aria-describedby={describedBy(noteId, noteError)}
              aria-invalid={noteError !== null}
              className="max-h-40"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <FlowsToMove
            chosen={chosen}
            disabled={publish.isPending}
            list={flowList}
            loadingId={loadingId}
            version={version}
            onChange={(id, checked) =>
              setChosen((current) => {
                const next = new Set(current)

                if (checked) {
                  next.add(id)
                } else {
                  next.delete(id)
                }

                return next
              })
            }
          />
        </form>
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
            disabled={publish.isPending || flowsLoading}
            focusableWhenDisabled
            form={`${noteId}-form`}
            type="submit"
            aria-describedby={flowsLoading ? loadingId : undefined}>
            {publish.isPending ? t('pending') : t('confirm', { version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
