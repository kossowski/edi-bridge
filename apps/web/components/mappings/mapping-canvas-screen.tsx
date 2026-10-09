'use client'

import { AlertCircleIcon, ComputerIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { BackLink, Fact, LoadFailure } from '@/components/detail-parts'
import { MappingCanvas } from '@/components/mappings/mapping-canvas'
import { documentTree, edifactTree, type TreeItem } from '@/components/mappings/mapping-tree'
import { useDesktop } from '@/hooks/use-desktop'
import { ApiError } from '@/lib/api/client'
import {
  documentStructureQuery,
  mappingDraftQuery,
  messageTypeStructureQuery,
} from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { MappingDraft, MappingSide } from '@edi-bridge/contracts'

function useSideTitle() {
  const t = useTranslations('Mapping.side')

  return (side: MappingSide) =>
    side.kind === 'documentStructure'
      ? t('documentStructure', { name: side.name })
      : t('messageType', { messageType: side.messageType })
}

function useSideTree(side: MappingSide) {
  const locale = useLocale()
  const documentStructureId = side.kind === 'documentStructure' ? side.documentStructureId : null
  const messageType = side.kind === 'messageType' ? side.messageType : null

  const documentStructure = useQuery({
    ...documentStructureQuery(documentStructureId ?? ''),
    enabled: documentStructureId !== null,
  })

  const messageTypeStructure = useQuery({
    ...messageTypeStructureQuery(messageType ?? 'ORDERS'),
    enabled: messageType !== null,
  })

  const query = documentStructureId !== null ? documentStructure : messageTypeStructure

  const items = useMemo((): TreeItem[] | undefined => {
    if (documentStructureId !== null) {
      return documentStructure.data && documentTree(documentStructure.data)
    }

    return messageTypeStructure.data && edifactTree(messageTypeStructure.data, locale)
  }, [documentStructure.data, documentStructureId, locale, messageTypeStructure.data])

  return { items, isError: query.isError, refetch: query.refetch }
}

function CanvasFailure({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Mapping.canvas.error')

  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </EmptyContent>
    </Empty>
  )
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
  const sideTitle = useSideTitle()
  const source = useSideTree(draft.source)
  const target = useSideTree(draft.target)

  if (source.isError || target.isError) {
    return (
      <CanvasFailure
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

  const sourceTitle = sideTitle(draft.source)
  const targetTitle = sideTitle(draft.target)

  return (
    <MappingCanvas
      label={t('label', { source: sourceTitle, target: targetTitle })}
      links={draft.links}
      source={{ title: sourceTitle, items: source.items }}
      target={{ title: targetTitle, items: target.items }}
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
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{draft.name}</h1>
        <Badge variant="outline">{t('draft')}</Badge>
      </div>
      <dl
        aria-label={t('facts.label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-x-6 gap-y-4 rounded-lg border p-4">
        <Fact label={t('facts.direction')}>{t(`direction.${draft.direction}`)}</Fact>
        <Fact label={t('facts.source')}>{sideTitle(draft.source)}</Fact>
        <Fact label={t('facts.target')}>{sideTitle(draft.target)}</Fact>
        <Fact label={t('facts.links')}>{t('linkCount', { count: draft.links.length })}</Fact>
      </dl>
      <DesktopOnlyNotice />
      {/* The canvas only mounts on desktop: React Flow cannot measure a hidden container. */}
      <div className="hidden min-h-[32rem] flex-1 flex-col lg:flex">
        {desktop && <Canvas draft={draft} />}
      </div>
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
