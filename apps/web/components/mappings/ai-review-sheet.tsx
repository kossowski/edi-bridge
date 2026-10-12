'use client'

import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Location01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'

import { Loading } from '@/components/detail-parts'
import {
  ancestorPaths,
  attentionCount,
  type ProposedChain,
  type ReviewAttention,
} from '@/components/mappings/ai-review-attention'
import { EditorSheetContent } from '@/components/mappings/editor-sheet'
import { useGraphText } from '@/components/mappings/graph-text'
import { useCanvasRefs, useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { PreviewFailure } from '@/components/mappings/mapping-preview-panel'
import { useSide } from '@/components/mappings/mapping-side'
import { findItem, type TreeItem } from '@/components/mappings/mapping-tree'
import { findTransformButton } from '@/components/mappings/transform-node'
import { findRowButton } from '@/components/mappings/tree-node'
import { useReviewAttention } from '@/components/mappings/use-review-attention'
import { whenRendered } from '@/components/mappings/when-rendered'
import { lookupTablesQuery, mappingSamplesQuery } from '@/lib/api/queries'
import { type AiReview, type MappingDraft, previewNoteKey } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Sheet, SheetTrigger } from '@edi-bridge/ui/components/sheet'
import { cn } from '@edi-bridge/ui/lib/utils'

type Group = 'unmapped' | 'transforms' | 'warnings' | 'plain'

type Entry = {
  key: string
  group: Group
  path: string | null
  name: string | undefined
  detail: string
  show: (() => void) | undefined
}

type ReviewState = ReturnType<typeof useReviewAttention>

// The canvas pans the focused part into view itself, so the page does not scroll to it.
function focusWhenShown(find: () => HTMLElement | null | undefined) {
  return () =>
    whenRendered(
      () => Boolean(find()),
      () => find()?.focus({ preventScroll: true }),
    )
}

function EntryName({ name, path }: { name: string | undefined; path: string | null }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      {name && name !== path && <span className="font-medium">{name}</span>}
      {path && (
        <span className="font-mono text-xs break-all" data-target-path={path}>
          {path}
        </span>
      )}
    </span>
  )
}

function EntryGroup({
  group,
  entries,
  empty,
  fallback,
  busy = false,
  onOpen,
}: {
  group: Group
  entries: Entry[] | undefined
  empty: string
  fallback?: ReactNode
  busy?: boolean
  onOpen: (entry: Entry) => void
}) {
  const t = useTranslations('Mapping.aiReview.panel')
  const headingId = useId()

  const list = () => {
    if (fallback) {
      return fallback
    }

    if (entries?.length === 0) {
      return <p className="text-muted-foreground text-sm">{empty}</p>
    }

    return (
      <ul aria-labelledby={headingId} className="divide-y rounded-lg border">
        {entries?.map((entry) => (
          <li key={entry.key}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-start font-normal whitespace-normal"
              data-entry={entry.key}
              onClick={() => onOpen(entry)}>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <EntryName name={entry.name} path={entry.path} />
                <span className="text-muted-foreground group-hover/button:text-foreground text-xs">
                  {entry.detail}
                </span>
              </span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                aria-hidden
                className="text-muted-foreground shrink-0"
              />
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section aria-busy={busy} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium">
        {t(`${group}.title`)}
        {entries && <Badge variant="secondary">{entries.length}</Badge>}
      </h3>
      {list()}
    </section>
  )
}

function EntryDetail({
  entry,
  headingRef,
  onBack,
}: {
  entry: Entry
  headingRef: RefObject<HTMLHeadingElement | null>
  onBack: () => void
}) {
  const t = useTranslations('Mapping.aiReview.panel')
  const whatToDoId = useId()
  const { show } = entry

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" className="-ms-2 self-start" onClick={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" />
        {t('back')}
      </Button>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium">{t(`${entry.group}.title`)}</p>
        <h3 ref={headingRef} tabIndex={-1} className="text-sm outline-none">
          <EntryName name={entry.name} path={entry.path} />
        </h3>
        <p className="text-sm">{entry.detail}</p>
      </div>
      <section aria-labelledby={whatToDoId} className="bg-muted/50 rounded-lg p-3 text-sm">
        <h4 id={whatToDoId} className="font-medium">
          {t('whatToDo')}
        </h4>
        <p className="text-muted-foreground">{t(`${entry.group}.explain`)}</p>
      </section>
      {show && (
        <Button className="self-start" onClick={show}>
          <HugeiconsIcon icon={Location01Icon} strokeWidth={2} data-icon="inline-start" />
          {t('show')}
        </Button>
      )}
    </div>
  )
}

function ReviewEntries({
  draft,
  review,
  targetItems,
  attention,
  state,
  onShow,
}: {
  draft: MappingDraft
  review: AiReview
  targetItems: ReadonlyArray<TreeItem>
  attention: ReviewAttention
  state: ReviewState
  onShow: (focus: () => void) => void
}) {
  const t = useTranslations('Mapping.aiReview.panel')
  const tNotes = useTranslations('Mapping.preview.notes')
  const refs = useCanvasRefs()
  const store = useCanvasStoreApi()
  const body = useRef<HTMLDivElement>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const returnTo = useRef<string | null>(null)
  const usesLookupTables = draft.transforms.some(({ kind }) => kind === 'lookupTable')
  const lookupTables = useQuery({ ...lookupTablesQuery, enabled: usesLookupTables })
  const text = useGraphText(draft.transforms, lookupTables.data)
  const samples = useQuery(mappingSamplesQuery(draft.mappingId))
  const sample = samples.data?.find(({ id: sampleId }) => sampleId === review.sampleId)
  const { preview, updating } = state

  const nameOf = (path: string) => {
    const item = findItem(targetItems, path)

    return item?.name ?? item?.label
  }

  const showTarget = (path: string) => () => {
    const { expand, select, openDetails } = store.getState()
    const row = { side: 'target' as const, path }

    expand('target', ancestorPaths(targetItems, path))
    select(row)
    openDetails()
    onShow(
      focusWhenShown(() => {
        const root = refs.canvas.current

        return root && findRowButton(root, row)
      }),
    )
  }

  const showTransform = (transformId: string) => () => {
    store.getState().selectTransform(transformId)
    onShow(
      focusWhenShown(() => {
        const root = refs.canvas.current

        return root && findTransformButton(root, { kind: 'header', transformId })
      }),
    )
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

  const unmapped = attention.unmapped.map((item): Entry => ({
    key: `unmapped:${item.path}`,
    group: 'unmapped',
    path: item.path,
    name: item.name ?? item.label,
    detail: t('unmapped.detail'),
    show: showTarget(item.path),
  }))

  const chainName = ({ targetPath, transformIds: [first] }: ProposedChain) => {
    if (targetPath !== null) {
      return nameOf(targetPath)
    }

    return first === undefined ? undefined : text.name(first)
  }

  const chains = attention.chains.map((chain): Entry => {
    const [first] = chain.transformIds

    return {
      key: `transforms:${chain.targetPath ?? chain.transformIds.join()}`,
      group: 'transforms',
      path: chain.targetPath,
      name: chainName(chain),
      detail: chainDetail(chain),
      show: first === undefined ? undefined : showTransform(first),
    }
  })

  const warnings = attention.warnings?.map((note): Entry => {
    const showNote = () => {
      if (note.transformId) {
        return showTransform(note.transformId)
      }

      return findItem(targetItems, note.targetPath) ? showTarget(note.targetPath) : undefined
    }

    return {
      key: `warnings:${previewNoteKey(note)}`,
      group: 'warnings',
      path: note.targetPath,
      name: nameOf(note.targetPath),
      detail: tNotes(note.code, { transform: note.transformId ? text.name(note.transformId) : '' }),
      show: showNote(),
    }
  })

  const plain = attention.plain.map((link): Entry => ({
    key: `plain:${link.targetPath}`,
    group: 'plain',
    path: link.targetPath,
    name: nameOf(link.targetPath),
    detail: t('plain.detail', { source: link.sourcePath }),
    show: showTarget(link.targetPath),
  }))

  const selected =
    [...unmapped, ...chains, ...(warnings ?? []), ...plain].find(
      (entry) => entry.key === selectedKey,
    ) ?? null

  const shownKey = selected?.key ?? null

  // In the same commit that removes the focused button, before the sheet takes the focus back.
  useLayoutEffect(() => {
    if (shownKey !== null) {
      detailHeading.current?.focus()

      return
    }

    const key = returnTo.current

    returnTo.current = null

    if (key !== null) {
      body.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(key)}"]`)?.focus()
    }
  }, [shownKey])

  const open = (entry: Entry) => setSelectedKey(entry.key)

  const back = () => {
    returnTo.current = selectedKey
    setSelectedKey(null)
  }

  const warningsFallback = () => {
    if (preview.isError) {
      return <PreviewFailure message={t('warnings.error')} onRetry={() => void preview.refetch()} />
    }

    return warnings ? undefined : (
      <Loading label={t('warnings.loading')} rowClassName="h-4" rows={3} />
    )
  }

  return (
    <div ref={body} className="flex flex-col gap-5">
      {selected ? (
        <EntryDetail entry={selected} headingRef={detailHeading} onBack={back} />
      ) : (
        <>
          <EntryGroup
            empty={t('unmapped.empty')}
            entries={unmapped}
            group="unmapped"
            onOpen={open}
          />
          <EntryGroup
            empty={t('transforms.empty')}
            entries={chains}
            group="transforms"
            onOpen={open}
          />
          <EntryGroup
            busy={updating}
            empty={sample ? t('warnings.empty', { name: sample.name }) : t('warnings.emptyUnnamed')}
            entries={warnings}
            fallback={warningsFallback()}
            group="warnings"
            onOpen={open}
          />
          {plain.length > 0 && <EntryGroup empty="" entries={plain} group="plain" onOpen={open} />}
        </>
      )}
    </div>
  )
}

// Modal, over the canvas: "Show on canvas" closes it and moves the focus to that part.
export function AiReviewSheet({ draft, review }: { draft: MappingDraft; review: AiReview }) {
  const t = useTranslations('Mapping.aiReview')
  const tCanvas = useTranslations('Mapping.canvas')
  const target = useSide(draft.target)
  const state = useReviewAttention(draft, target.items)
  const { attention } = state
  // Until the warnings are in, a count would be too low, and "nothing" could be wrong.
  const known = attention && (attention.warnings !== undefined || state.preview.isError)
  const count = attention && known ? attentionCount(attention) : null
  const [open, setOpen] = useState(false)
  const focusAfterClose = useRef<(() => void) | null>(null)

  const show = (focus: () => void) => {
    focusAfterClose.current = focus
    setOpen(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          focusAfterClose.current?.()
          focusAfterClose.current = null
        }
      }}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            aria-busy={state.updating}
            className={cn(
              count !== null &&
                count > 0 &&
                'border-ai-attention bg-ai-attention/15 hover:bg-ai-attention/30 aria-expanded:bg-ai-attention/30 dark:border-ai-attention dark:bg-ai-attention/15 dark:hover:bg-ai-attention/30',
            )}
          />
        }>
        <HugeiconsIcon
          icon={count === 0 ? CheckmarkCircle02Icon : Alert02Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        {count === null ? t('panel.title') : t('attention', { count })}
      </SheetTrigger>
      <EditorSheetContent
        closeLabel={t('panel.close')}
        description={t('panel.description')}
        finalFocus={() => focusAfterClose.current === null}
        title={t('panel.title')}
        className="data-[side=right]:sm:max-w-md">
        {target.items && attention ? (
          <ReviewEntries
            attention={attention}
            draft={draft}
            review={review}
            state={state}
            targetItems={target.items}
            onShow={show}
          />
        ) : (
          <Loading label={tCanvas('loading')} rowClassName="h-4" rows={3} />
        )}
      </EditorSheetContent>
    </Sheet>
  )
}
