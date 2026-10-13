'use client'

import { ComputerIcon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type RefObject, useId, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { Fact, LoadFailure } from '@/components/detail-parts'
import { AiDraftAction } from '@/components/mappings/ai-draft'
import { AiReviewSheet } from '@/components/mappings/ai-review-sheet'
import { AiReviewState } from '@/components/mappings/ai-review-state'
import { EditorSheetContent } from '@/components/mappings/editor-sheet'
import { type FailingField } from '@/components/mappings/failing-field'
import { FailingFieldAlert, useFailingField } from '@/components/mappings/failing-field-alert'
import { GraphSaveStatus } from '@/components/mappings/graph-save-status'
import { MappingCanvas, type MappingCanvasHandle } from '@/components/mappings/mapping-canvas'
import {
  detailsShown,
  MappingCanvasProvider,
  useCanvasRefs,
  useCanvasStore,
  useCanvasStoreApi,
} from '@/components/mappings/mapping-canvas-store'
import { isEmptyGraph } from '@/components/mappings/mapping-graph'
import { MappingPreviewSheet } from '@/components/mappings/mapping-preview-panel'
import { useSide, useSideTitle } from '@/components/mappings/mapping-side'
import { DraftStateLabel, PublishDraft } from '@/components/mappings/publish-draft'
import { StartHere } from '@/components/mappings/start-here'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useAiDraftRun } from '@/components/mappings/use-ai-draft-run'
import { type ReviewState, useReviewAttention } from '@/components/mappings/use-review-attention'
import { useSaveGraph } from '@/components/mappings/use-save-graph'
import { VersionsSheet } from '@/components/mappings/versions-sheet'
import { whenRendered } from '@/components/mappings/when-rendered'
import { useDesktop } from '@/hooks/use-desktop'
import { useSession } from '@/hooks/use-session'
import { ApiError } from '@/lib/api/client'
import { mappingDraftQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Sheet, SheetTrigger } from '@edi-bridge/ui/components/sheet'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { SideQuery } from '@/components/mappings/mapping-side'
import type { AiReview, MappingDraft } from '@edi-bridge/contracts'

function CanvasLoading() {
  const t = useTranslations('Mapping.canvas')

  return (
    <div aria-busy className="flex flex-1 gap-6 rounded-lg border p-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      {[0, 1].map((column) => (
        <div key={column} className="flex flex-1 flex-col gap-2">
          <Skeleton className="mb-2 h-5 w-48" />
          {Array.from({ length: 8 }, (_, row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}

function Canvas({
  draft,
  source,
  target,
  failingField,
  review,
  ref,
}: {
  draft: MappingDraft
  source: SideQuery
  target: SideQuery
  failingField: FailingField | null
  review: ReviewState
  ref: RefObject<MappingCanvasHandle | null>
}) {
  const t = useTranslations('Mapping.canvas')
  const save = useSaveGraph(draft.mappingId)

  if (source.isError || target.isError) {
    return (
      <LoadFailure
        namespace="Mapping.canvas"
        notFound={false}
        onRetry={() => {
          void (source.isError && source.refetch())
          void (target.isError && target.refetch())
        }}
      />
    )
  }

  if (!source.items || !target.items) {
    return <CanvasLoading />
  }

  return (
    <MappingCanvas
      aiAttention={review.onCanvas}
      detailsFacts={<MappingFacts draft={draft} />}
      failingField={failingField}
      graph={draft}
      label={t('label', { source: source.title, target: target.title })}
      ref={ref}
      source={{ title: source.title, items: source.items }}
      target={{ title: target.title, items: target.items }}
      onChange={save}
    />
  )
}

function DesktopOnlyNotice() {
  const t = useTranslations('Mapping.desktopOnly')

  return (
    <Empty className="flex-none border lg:hidden">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('description')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function MappingFacts({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping')
  const sideTitle = useSideTitle()

  return (
    <dl aria-label={t('facts.label')} className="grid grid-cols-2 gap-x-6 gap-y-4">
      <Fact label={t('facts.direction')}>{t(`direction.${draft.direction}`)}</Fact>
      <Fact label={t('facts.source')}>{sideTitle(draft.source)}</Fact>
      <Fact label={t('facts.target')}>{sideTitle(draft.target)}</Fact>
      <Fact label={t('facts.links')}>
        {t('linkCount', { count: draft.links.length + draft.transformLinks.length })}
      </Fact>
      <Fact label={t('facts.transforms')}>
        {t('transforms.count', { count: draft.transforms.length })}
      </Fact>
    </dl>
  )
}

// On a computer the details belong to the canvas, which also shows a selection in them; without
// the canvas, on a small screen or under "Start here", a sheet shows the facts alone.
function DetailsAction({ draft, withoutCanvas }: { draft: MappingDraft; withoutCanvas: boolean }) {
  const t = useTranslations('Mapping.details')
  const desktop = useDesktop()
  const store = useCanvasStoreApi()
  const { detailsBody, detailsTrigger } = useCanvasRefs()
  const open = useCanvasStore(detailsShown)
  const icon = <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} aria-hidden />

  if (!desktop || withoutCanvas) {
    return (
      <Sheet>
        <ToolbarAction
          icon={icon}
          label={t('title')}
          render={<SheetTrigger render={<Button variant="outline" />} />}
        />
        <EditorSheetContent
          closeLabel={t('close')}
          description={t('description')}
          title={t('title')}>
          <MappingFacts draft={draft} />
        </EditorSheetContent>
      </Sheet>
    )
  }

  const toggle = () => {
    if (open) {
      store.getState().closeDetails()
    } else {
      store.getState().openDetails()
      whenRendered(
        () => Boolean(detailsBody.current),
        () => detailsBody.current?.focus(),
      )
    }
  }

  return (
    <ToolbarAction
      icon={icon}
      label={t('title')}
      render={
        <Button
          ref={detailsTrigger}
          variant="outline"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggle}
        />
      }
    />
  )
}

function EditorBody({
  draft,
  source,
  target,
  review,
  field,
  canChange,
  startHere,
  onAiDraft,
  onLinkYourself,
}: {
  draft: MappingDraft
  source: SideQuery
  target: SideQuery
  review: ReviewState
  field: string | undefined
  canChange: boolean
  startHere: boolean
  onAiDraft: () => void
  onLinkYourself: () => void
}) {
  const desktop = useDesktop()
  const canvas = useRef<MappingCanvasHandle>(null)
  const lookup = useFailingField(field, source, target)
  const failingField = lookup.status === 'found' ? lookup.field : null

  // Under "Start here" the editor mounts first; the canvas then takes over from the chosen button.
  const withCanvas = (then: (handle: MappingCanvasHandle) => void) =>
    whenRendered(
      () => canvas.current !== null,
      () => canvas.current && then(canvas.current),
    )

  const linkYourself = () => {
    onLinkYourself()
    withCanvas((handle) => handle.focusFirstRow())
  }

  const showField = () => {
    onLinkYourself()
    withCanvas((handle) => handle.showFailingField())
  }

  return (
    <>
      {(lookup.status === 'found' || lookup.status === 'notFound') && (
        <FailingFieldAlert
          canChange={canChange}
          lookup={lookup}
          marked={desktop && !startHere}
          onShow={desktop ? showField : undefined}
        />
      )}
      <DesktopOnlyNotice />
      {startHere ? (
        <div className="hidden min-h-0 flex-1 flex-col overflow-y-auto lg:flex">
          <StartHere draft={draft} onAiDraft={onAiDraft} onLinkYourself={linkYourself} />
        </div>
      ) : (
        // The canvas only mounts on desktop: React Flow cannot measure a hidden container.
        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          {desktop && (
            <Canvas
              draft={draft}
              failingField={failingField}
              ref={canvas}
              review={review}
              source={source}
              target={target}
            />
          )}
        </div>
      )}
    </>
  )
}

function MappingLoading() {
  const t = useTranslations('Mapping')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

function MappingEditor({
  id,
  draft,
  field,
  canChange,
  aiReview,
}: {
  id: string
  draft: MappingDraft
  field: string | undefined
  canChange: boolean
  aiReview: AiReview | null
}) {
  const desktop = useDesktop()
  const stateId = useId()
  const reviewSummaryId = useId()
  const publishHintId = useId()
  const aiDraft = useAiDraftRun(id)
  const source = useSide(draft.source)
  const target = useSide(draft.target)
  const review = useReviewAttention(draft, target.items, desktop)
  const [aiDraftOpen, setAiDraftOpen] = useState(false)
  // Per visit: once the Mapping has links, or the user chose to link the fields, the editor stays.
  const [started, setStarted] = useState(false)

  if (!started && !isEmptyGraph(draft)) {
    setStarted(true)
  }

  const startHere = canChange && !started

  return (
    // On desktop the editor fills the viewport below the header: a thin toolbar, then the canvas at
    // full height without page scrolling.
    <AppPage
      actions={
        <>
          {aiReview && desktop && (
            <AiReviewSheet draft={draft} state={review} targetItems={target.items} />
          )}
          {canChange && desktop && (
            <AiDraftAction
              aiDraft={aiDraft}
              draft={draft}
              open={aiDraftOpen}
              reviewSummaryId={reviewSummaryId}
              onOpenChange={setAiDraftOpen}
            />
          )}
          <MappingPreviewSheet draft={draft} reviewSampleId={aiReview?.sampleId ?? null} />
          <DetailsAction draft={draft} withoutCanvas={startHere} />
          <VersionsSheet draft={draft} />
          {canChange && (
            <PublishDraft draft={draft} reviewHintId={publishHintId} stateId={stateId} />
          )}
        </>
      }
      meta={
        <>
          <DraftStateLabel id={stateId} draft={draft} />
          {canChange && <GraphSaveStatus mappingId={id} />}
        </>
      }
      name={draft.name}
      className="lg:gap-3 lg:px-4 lg:py-3 lg:contain-size">
      {canChange && (
        <AiReviewState draft={draft} publishHintId={publishHintId} summaryId={reviewSummaryId} />
      )}
      <EditorBody
        canChange={canChange}
        draft={draft}
        field={field}
        review={review}
        source={source}
        startHere={startHere}
        target={target}
        onAiDraft={() => setAiDraftOpen(true)}
        onLinkYourself={() => setStarted(true)}
      />
    </AppPage>
  )
}

export function MappingCanvasScreen({ id, field }: { id: string; field?: string | undefined }) {
  const { data, error, isPending, refetch } = useQuery(mappingDraftQuery(id))
  const session = useSession()
  const draft = session.isPending ? undefined : data
  const canChange = session.canChange
  const aiReview = canChange ? (draft?.aiReview ?? null) : null

  return (
    <MappingCanvasProvider aiReview={aiReview} viewOnly={!canChange}>
      {draft ? (
        <MappingEditor
          id={id}
          aiReview={aiReview}
          canChange={canChange}
          draft={draft}
          field={field}
        />
      ) : (
        <AppPage className="lg:gap-3 lg:px-4 lg:py-3 lg:contain-size">
          {isPending || session.isPending ? (
            <MappingLoading />
          ) : (
            <LoadFailure
              namespace="Mapping"
              notFound={error instanceof ApiError && error.status === 404}
              onRetry={() => void refetch()}
            />
          )}
        </AppPage>
      )}
    </MappingCanvasProvider>
  )
}
