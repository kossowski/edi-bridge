'use client'

import { ComputerIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { BackLink, Fact, LoadFailure } from '@/components/detail-parts'
import { AiDraftAction } from '@/components/mappings/ai-draft'
import { AiReviewState } from '@/components/mappings/ai-review-state'
import { GraphSaveStatus } from '@/components/mappings/graph-save-status'
import { MappingCanvas } from '@/components/mappings/mapping-canvas'
import { MappingCanvasProvider } from '@/components/mappings/mapping-canvas-store'
import { MappingPreviewPanel } from '@/components/mappings/mapping-preview-panel'
import { useSide, useSideTitle } from '@/components/mappings/mapping-side'
import {
  DraftStateLabel,
  MappingVersionsLink,
  PublishDraft,
} from '@/components/mappings/publish-draft'
import { useAiDraftRun } from '@/components/mappings/use-ai-draft-run'
import { useSaveGraph } from '@/components/mappings/use-save-graph'
import { useDesktop } from '@/hooks/use-desktop'
import { useSession } from '@/hooks/use-session'
import { ApiError } from '@/lib/api/client'
import { mappingDraftQuery } from '@/lib/api/queries'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
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
      beside={(band) => <MappingPreviewPanel draft={draft} {...band} />}
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

function MappingView({ draft, canChange }: { draft: MappingDraft; canChange: boolean }) {
  const t = useTranslations('Mapping')
  const sideTitle = useSideTitle()
  const desktop = useDesktop()
  const stateId = useId()
  const aiDraft = useAiDraftRun(draft.mappingId)

  return (
    <MappingCanvasProvider aiReview={draft.aiReview} viewOnly={!canChange}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{draft.name}</h1>
        <DraftStateLabel id={stateId} draft={draft} />
        {canChange && <GraphSaveStatus mappingId={draft.mappingId} />}
        <AiReviewState canChange={canChange} draft={draft} />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {canChange ? (
            <>
              {desktop && <AiDraftAction aiDraft={aiDraft} draft={draft} />}
              <PublishDraft draft={draft} stateId={stateId} />
            </>
          ) : (
            <MappingVersionsLink mappingId={draft.mappingId} />
          )}
        </div>
      </div>
      <dl
        aria-label={t('facts.label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
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
      <DesktopOnlyNotice />
      {/* The canvas only mounts on desktop: React Flow cannot measure a hidden container. */}
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        {desktop && <Canvas draft={draft} />}
      </div>
    </MappingCanvasProvider>
  )
}

function MappingLoading() {
  const t = useTranslations('Mapping')

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export function MappingCanvasScreen({ id }: { id: string }) {
  const t = useTranslations('Mapping')
  const { data, error, isPending, refetch } = useQuery(mappingDraftQuery(id))
  const session = useSession()

  // On desktop the screen takes the viewport below the app header (h-14), so the canvas and the
  // band under it share the height without page scrolling.
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6 lg:h-[calc(100svh-3.5rem)] lg:flex-none lg:gap-3 lg:py-4">
      <BackLink href="/mappings" label={t('back')} />
      {isPending || session.isPending ? (
        <MappingLoading />
      ) : data ? (
        <MappingView canChange={session.canChange} draft={data} />
      ) : (
        <LoadFailure
          namespace="Mapping"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
