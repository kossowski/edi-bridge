'use client'

import { ComputerIcon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { AppPage } from '@/components/app-page'
import { Fact, LoadFailure } from '@/components/detail-parts'
import { AiDraftAction } from '@/components/mappings/ai-draft'
import { AiReviewState } from '@/components/mappings/ai-review-state'
import { EditorSheetContent } from '@/components/mappings/editor-sheet'
import { GraphSaveStatus } from '@/components/mappings/graph-save-status'
import { MappingCanvas } from '@/components/mappings/mapping-canvas'
import {
  detailsShown,
  MappingCanvasProvider,
  useCanvasRefs,
  useCanvasStore,
  useCanvasStoreApi,
} from '@/components/mappings/mapping-canvas-store'
import { MappingPreviewSheet } from '@/components/mappings/mapping-preview-panel'
import { useSide, useSideTitle } from '@/components/mappings/mapping-side'
import { DraftStateLabel, PublishDraft } from '@/components/mappings/publish-draft'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useAiDraftRun } from '@/components/mappings/use-ai-draft-run'
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

import type { MappingDraft } from '@edi-bridge/contracts'

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

function Canvas({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.canvas')
  const source = useSide(draft.source)
  const target = useSide(draft.target)
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
      detailsFacts={<MappingFacts draft={draft} />}
      graph={draft}
      label={t('label', { source: source.title, target: target.title })}
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

// On a computer the details belong to the canvas, which also shows a selection in them; on a
// small screen, without the canvas, a sheet shows the facts alone.
function DetailsAction({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.details')
  const desktop = useDesktop()
  const store = useCanvasStoreApi()
  const { detailsBody, detailsTrigger } = useCanvasRefs()
  const open = useCanvasStore(detailsShown)
  const icon = <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} aria-hidden />

  if (!desktop) {
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

export function MappingCanvasScreen({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useQuery(mappingDraftQuery(id))
  const session = useSession()
  const desktop = useDesktop()
  const stateId = useId()
  const reviewSummaryId = useId()
  const publishHintId = useId()
  const aiDraft = useAiDraftRun(id)
  const draft = session.isPending ? undefined : data
  const canChange = session.canChange
  const aiReview = canChange ? (draft?.aiReview ?? null) : null

  return (
    <MappingCanvasProvider aiReview={aiReview} viewOnly={!canChange}>
      {/* On desktop the editor fills the viewport below the header: a thin toolbar, then the canvas
          at full height without page scrolling. */}
      <AppPage
        actions={
          draft && (
            <>
              {canChange && desktop && (
                <AiDraftAction aiDraft={aiDraft} draft={draft} reviewSummaryId={reviewSummaryId} />
              )}
              <MappingPreviewSheet draft={draft} reviewSampleId={aiReview?.sampleId ?? null} />
              <DetailsAction draft={draft} />
              <VersionsSheet draft={draft} />
              {canChange && (
                <PublishDraft draft={draft} reviewHintId={publishHintId} stateId={stateId} />
              )}
            </>
          )
        }
        meta={
          draft && (
            <>
              <DraftStateLabel id={stateId} draft={draft} />
              {canChange && <GraphSaveStatus mappingId={id} />}
            </>
          )
        }
        name={draft?.name}
        className="lg:gap-3 lg:px-4 lg:py-3 lg:contain-size">
        {draft ? (
          <>
            {canChange && (
              <AiReviewState
                draft={draft}
                publishHintId={publishHintId}
                showReview={desktop}
                summaryId={reviewSummaryId}
              />
            )}
            <DesktopOnlyNotice />
            {/* The canvas only mounts on desktop: React Flow cannot measure a hidden container. */}
            <div className="hidden min-h-0 flex-1 flex-col lg:flex">
              {desktop && <Canvas draft={draft} />}
            </div>
          </>
        ) : isPending || session.isPending ? (
          <MappingLoading />
        ) : (
          <LoadFailure
            namespace="Mapping"
            notFound={error instanceof ApiError && error.status === 404}
            onRetry={() => void refetch()}
          />
        )}
      </AppPage>
    </MappingCanvasProvider>
  )
}
