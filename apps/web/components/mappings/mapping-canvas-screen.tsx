'use client'

import { ComputerIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type QueryKey, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'

import { BackLink, Fact, LoadFailure } from '@/components/detail-parts'
import { GraphSaveStatus } from '@/components/mappings/graph-save-status'
import { MappingCanvas } from '@/components/mappings/mapping-canvas'
import { MappingCanvasProvider } from '@/components/mappings/mapping-canvas-store'
import { documentTree, edifactTree, type TreeItem } from '@/components/mappings/mapping-tree'
import { useSaveGraph } from '@/components/mappings/use-save-graph'
import { useDesktop } from '@/hooks/use-desktop'
import { ApiError, getDocumentStructure, getMessageTypeStructure } from '@/lib/api/client'
import { documentStructureKeys, mappingDraftQuery, messageTypeKeys } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Locale } from '@/i18n/locales'
import type { MappingDraft, MappingSide } from '@edi-bridge/contracts'

// The sides load different structures, but past `select` the canvas only sees the tree; leaving
// the structure type out of the options lets one `useQuery` call serve both kinds of side.
function treeQuery<Data>(
  queryKey: QueryKey,
  queryFn: () => Promise<Data>,
  tree: (data: Data) => TreeItem[],
): UseQueryOptions<unknown, Error, TreeItem[]> {
  return {
    queryKey,
    queryFn,
    // SAFETY: `select` only receives what `queryFn` above returned, which is Data.
    select: (data) => tree(data as Data),
  }
}

function sideOf(
  side: MappingSide,
  t: ReturnType<typeof useTranslations<'Mapping'>>,
  locale: Locale,
) {
  switch (side.kind) {
    case 'documentStructure':
      return {
        title: t('side.documentStructure', { name: side.name }),
        query: treeQuery(
          documentStructureKeys.detail(side.documentStructureId),
          () => getDocumentStructure(side.documentStructureId),
          documentTree,
        ),
      }
    case 'messageType':
      return {
        title: t('side.messageType', { messageType: side.messageType }),
        query: treeQuery(
          messageTypeKeys.structure(side.messageType),
          () => getMessageTypeStructure(side.messageType),
          (structure) => edifactTree(structure, locale),
        ),
      }
  }
}

function useSideTitle() {
  const t = useTranslations('Mapping')
  const locale = useLocale()

  return (side: MappingSide) => sideOf(side, t, locale).title
}

function useSide(side: MappingSide) {
  const t = useTranslations('Mapping')
  const locale = useLocale()
  const { title, query } = sideOf(side, t, locale)
  const { data: items, isError, refetch } = useQuery(query)

  return { title, items, isError, refetch }
}

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

function MappingView({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping')
  const sideTitle = useSideTitle()
  const desktop = useDesktop()

  return (
    <MappingCanvasProvider>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{draft.name}</h1>
        <Badge variant="outline">{t('draft')}</Badge>
        <GraphSaveStatus mappingId={draft.mappingId} />
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
      <div className="hidden min-h-[32rem] flex-1 flex-col lg:flex">
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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <BackLink href="/mappings" label={t('back')} />
      {isPending ? (
        <MappingLoading />
      ) : data ? (
        <MappingView draft={data} />
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
