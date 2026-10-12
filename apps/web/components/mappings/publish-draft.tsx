'use client'

import { CloudUploadIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
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
import {
  changeNoteProblem,
  chosenRouteIds,
  type RouteInUse,
  routesInUse,
} from '@/components/mappings/publish-plan'
import { StateBadge } from '@/components/mappings/state-badge'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useGraphSaveState } from '@/components/mappings/use-save-graph'
import { ApiError, publishMappingDraft } from '@/lib/api/client'
import {
  mappingDraftQuery,
  mappingVersionsQuery,
  storePublishedMappingVersion,
} from '@/lib/api/queries'
import {
  maxChangeNoteLength,
  type MappingDraft,
  type MappingVersionEntry,
} from '@edi-bridge/contracts'
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
        state={state.kind === 'published' ? 'live' : 'draft'}
        tabIndex={id === undefined ? undefined : -1}
        className="h-7 gap-2 px-3 text-sm [&>svg]:size-4!">
        {state.kind === 'neverPublished'
          ? t('state.neverPublished')
          : t(`state.${state.kind}`, { version: state.version })}
      </StateBadge>
    </span>
  )
}

const routeNamesShown = 3

function KeptRoutes({ kept, version }: { kept: ReadonlyArray<RouteInUse>; version: number }) {
  const t = useTranslations('Mapping.publish.routes')
  const format = useFormatter()

  return (
    <p className="text-muted-foreground text-sm">
      {kept.length > routeNamesShown
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

function RouteChoices({
  routes,
  version,
  chosen,
  disabled,
  onChange,
}: {
  routes: ReadonlyArray<RouteInUse>
  version: number
  chosen: ReadonlySet<string>
  disabled: boolean
  onChange: (id: string, checked: boolean) => void
}) {
  const t = useTranslations('Mapping.publish.routes')
  const descriptionId = useId()

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t('legend')}</legend>
      <ul className="flex flex-col gap-1">
        {routes.map((route) => (
          <li
            key={route.id}
            className="has-data-checked:border-primary/30 has-data-checked:bg-primary/5 hover:bg-muted/50 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10 relative flex flex-col gap-0.5 rounded-lg border px-3 py-2">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-medium break-words after:absolute after:inset-0">
              <Checkbox
                checked={chosen.has(route.id)}
                disabled={disabled}
                aria-describedby={`${descriptionId}-${route.id}`}
                className="mt-0.5"
                onCheckedChange={(checked) => onChange(route.id, checked)}
              />
              <span className="min-w-0">
                {t('move', { route: route.name, partner: route.partner, version })}
              </span>
            </label>
            <span
              id={`${descriptionId}-${route.id}`}
              className="text-muted-foreground ps-7 text-xs">
              {t('current', { version: route.version })}
            </span>
          </li>
        ))}
      </ul>
      <KeptRoutes kept={routes.filter(({ id }) => !chosen.has(id))} version={version} />
    </fieldset>
  )
}

function RoutesToMove({
  history,
  published,
  version,
  chosen,
  disabled,
  onChange,
}: {
  history: UseQueryResult<MappingVersionEntry[]>
  published: boolean
  version: number
  chosen: ReadonlySet<string>
  disabled: boolean
  onChange: (id: string, checked: boolean) => void
}) {
  const t = useTranslations('Mapping.publish.routes')

  if (!published) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  if (history.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-red-800 dark:text-red-300">{t('error')}</p>
        <Button size="sm" variant="outline" onClick={() => void history.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (!history.data) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          {t('loading')}
        </p>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  const routes = routesInUse(history.data)

  return routes.length === 0 ? (
    <p className="text-muted-foreground text-sm">{t('none')}</p>
  ) : (
    <RouteChoices
      chosen={chosen}
      disabled={disabled}
      routes={routes}
      version={version}
      onChange={onChange}
    />
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

  const history = useQuery({
    ...mappingVersionsQuery(draft.mappingId),
    enabled: open && published,
  })

  const routes = history.data ? routesInUse(history.data) : []

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
    if (noteProblem) {
      flushSync(() => setNoteChecked(true))
      noteRef.current?.focus()

      return
    }

    publish.mutate(chosenRouteIds(routes, chosen))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (publish.isPending) {
          return
        }

        if (next) {
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
          <RoutesToMove
            chosen={chosen}
            disabled={publish.isPending}
            history={history}
            published={published}
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
            disabled={publish.isPending}
            focusableWhenDisabled
            form={`${noteId}-form`}
            type="submit">
            {publish.isPending ? t('pending') : t('confirm', { version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
