'use client'

import { ArrowDown01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'

import { Loading } from '@/components/detail-parts'
import { useAiMarks } from '@/components/mappings/ai-marks'
import {
  ancestorPaths,
  type ProposedChain,
  reviewAttention,
} from '@/components/mappings/ai-review-attention'
import { useGraphText } from '@/components/mappings/graph-text'
import { useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { PreviewFailure } from '@/components/mappings/mapping-preview-panel'
import { findItem, type TreeItem } from '@/components/mappings/mapping-tree'
import { findTransformButton } from '@/components/mappings/transform-node'
import { findRowButton } from '@/components/mappings/tree-node'
import { useDraftPreview } from '@/components/mappings/use-draft-preview'
import { lookupTablesQuery, mappingSamplesQuery } from '@/lib/api/queries'
import { type AiReview, type MappingDraft, previewNoteKey } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'

// About a second at 60 fps: an expanded part shows its rows a few frames after the click.
const focusWaitFrames = 60

function focusWhenShown(find: () => HTMLElement | null | undefined, frames = focusWaitFrames) {
  requestAnimationFrame(() => {
    const element = find()

    if (element) {
      element.focus()
    } else if (frames > 0) {
      focusWhenShown(find, frames - 1)
    }
  })
}

function TargetName({ item, path }: { item: TreeItem | undefined; path: string }) {
  const name = item?.name ?? item?.label

  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      {name && name !== path && <span className="font-medium">{name}</span>}
      <span className="font-mono text-xs break-all">{path}</span>
    </span>
  )
}

function Item({
  onActivate,
  children,
}: {
  onActivate: (() => void) | undefined
  children: ReactNode
}) {
  const content = <span className="flex min-w-0 flex-col items-start gap-0.5">{children}</span>

  return (
    <li>
      {onActivate ? (
        <Button
          variant="ghost"
          className="h-auto w-full justify-start px-2 py-1.5 text-start font-normal whitespace-normal"
          onClick={onActivate}>
          {content}
        </Button>
      ) : (
        <div className="px-2 py-1.5 text-sm">{content}</div>
      )}
    </li>
  )
}

function Detail({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-xs">{children}</span>
}

function Group({
  title,
  count,
  empty,
  children,
  busy = false,
}: {
  title: string
  count: number | null
  empty: string
  children: ReactNode
  busy?: boolean
}) {
  const headingId = useId()

  return (
    <div aria-busy={busy} className="flex flex-col gap-1">
      <h3 id={headingId} className="flex items-center gap-2 px-2 text-sm font-medium">
        {title} {count !== null && <Badge variant="secondary">{count}</Badge>}
      </h3>
      {count === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">{empty}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col">
          {children}
        </ul>
      )}
    </div>
  )
}

export function AiReviewPanel({
  draft,
  review,
  targetItems,
  open,
  id,
  bodyId,
}: {
  draft: MappingDraft
  review: AiReview
  targetItems: ReadonlyArray<TreeItem>
  open: boolean
  id: string
  bodyId: string
}) {
  const t = useTranslations('Mapping.aiReview.panel')
  const tNotes = useTranslations('Mapping.preview.notes')
  const headingId = useId()
  const otherId = useId()
  const ref = useRef<HTMLElement>(null)
  const store = useCanvasStoreApi()
  const marks = useAiMarks()
  const [showOther, setShowOther] = useState(false)
  const usesLookupTables = draft.transforms.some(({ kind }) => kind === 'lookupTable')
  const lookupTables = useQuery({ ...lookupTablesQuery, enabled: usesLookupTables })
  const text = useGraphText(draft.transforms, lookupTables.data)
  const samples = useQuery(mappingSamplesQuery(draft.mappingId))
  const sample = samples.data?.find(({ id: sampleId }) => sampleId === review.sampleId)
  const { preview, updating } = useDraftPreview(draft, review.sampleId)

  const attention = useMemo(
    () => reviewAttention({ graph: draft, marks, targetItems, notes: preview.data?.notes }),
    [draft, marks, preview.data?.notes, targetItems],
  )

  const itemOf = (path: string) => findItem(targetItems, path)

  const canvas = () => ref.current?.closest<HTMLElement>('[data-mapping-canvas]')

  const showTarget = (path: string) => {
    const { expand, select } = store.getState()
    const row = { side: 'target' as const, path }

    expand('target', ancestorPaths(targetItems, path))
    select(row)
    focusWhenShown(() => {
      const root = canvas()

      return root && findRowButton(root, row)
    })
  }

  const showTransform = (transformId: string) => {
    store.getState().selectTransform(transformId)
    focusWhenShown(() => {
      const root = canvas()

      return root && findTransformButton(root, { kind: 'header', transformId })
    })
  }

  const transformText = (transformId: string) => {
    const transform = draft.transforms.find(({ id: own }) => own === transformId)
    const name = text.name(transformId)

    return transform?.kind === 'lookupTable'
      ? t('lookupTable', { name, table: text.summary(transform) })
      : name
  }

  const chainDetail = (chain: ProposedChain) => {
    const transforms = chain.transformIds.map(transformText).join(', ')

    if (chain.targetPath === null) {
      return t('fillsNothing', { transforms })
    }

    return chain.sourcePaths.length > 0
      ? t('through', { sources: chain.sourcePaths.join(', '), transforms })
      : t('throughOnly', { transforms })
  }

  const warnings = () => {
    if (preview.isError) {
      return (
        <li className="px-2">
          <PreviewFailure message={t('warnings.error')} onRetry={() => void preview.refetch()} />
        </li>
      )
    }

    if (!attention.warnings) {
      return (
        <li className="px-2">
          <Loading label={t('warnings.loading')} rowClassName="h-4" rows={3} />
        </li>
      )
    }

    return attention.warnings.map((note) => (
      <Item
        key={previewNoteKey(note)}
        onActivate={
          note.transformId
            ? () => showTransform(note.transformId!)
            : itemOf(note.targetPath)
              ? () => showTarget(note.targetPath)
              : undefined
        }>
        <TargetName item={itemOf(note.targetPath)} path={note.targetPath} />
        <Detail>
          {tNotes(note.code, { transform: note.transformId ? text.name(note.transformId) : '' })}
        </Detail>
      </Item>
    ))
  }

  return (
    <section
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="bg-card focus-visible:ring-ring/50 flex min-h-0 min-w-0 flex-col rounded-lg border outline-none focus-visible:ring-3">
      <div className="flex min-h-11 shrink-0 items-center px-4 py-1.5">
        <h2 id={headingId} className="text-sm font-semibold">
          {t('title')}
        </h2>
      </div>
      <div
        id={bodyId}
        hidden={!open}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t px-2 py-3">
        <p className="text-muted-foreground px-2 text-sm">{t('description')}</p>
        <Group
          count={attention.unmapped.length}
          empty={t('unmapped.empty')}
          title={t('unmapped.title')}>
          {attention.unmapped.map((item) => (
            <Item key={item.path} onActivate={() => showTarget(item.path)}>
              <TargetName item={item} path={item.path} />
              <Detail>{t('unmapped.detail')}</Detail>
            </Item>
          ))}
        </Group>
        <Group
          count={attention.chains.length}
          empty={t('transforms.empty')}
          title={t('transforms.title')}>
          {attention.chains.map((chain) => (
            <Item
              key={chain.targetPath ?? chain.transformIds.join()}
              onActivate={() => showTransform(chain.transformIds[0]!)}>
              {chain.targetPath === null ? (
                <span className="font-medium">{text.name(chain.transformIds[0]!)}</span>
              ) : (
                <TargetName item={itemOf(chain.targetPath)} path={chain.targetPath} />
              )}
              <Detail>{chainDetail(chain)}</Detail>
            </Item>
          ))}
        </Group>
        <Group
          busy={updating}
          count={attention.warnings?.length ?? null}
          empty={sample ? t('warnings.empty', { name: sample.name }) : t('warnings.emptyUnnamed')}
          title={t('warnings.title')}>
          {warnings()}
        </Group>
        {attention.plain.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">
              <Button
                size="sm"
                variant="ghost"
                aria-controls={otherId}
                aria-expanded={showOther}
                className="gap-2"
                onClick={() => setShowOther((shown) => !shown)}>
                <HugeiconsIcon
                  icon={showOther ? ArrowDown01Icon : ArrowRight01Icon}
                  strokeWidth={2}
                  aria-hidden
                />
                {t('plain.title')} <Badge variant="secondary">{attention.plain.length}</Badge>
              </Button>
            </h3>
            <ul id={otherId} hidden={!showOther} aria-label={t('plain.title')}>
              {showOther &&
                attention.plain.map((link) => (
                  <Item key={link.targetPath} onActivate={() => showTarget(link.targetPath)}>
                    <TargetName item={itemOf(link.targetPath)} path={link.targetPath} />
                    <Detail>{t('plain.detail', { source: link.sourcePath })}</Detail>
                  </Item>
                ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
