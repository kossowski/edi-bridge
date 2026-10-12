'use client'

import { Loading03Icon, ViewIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Loading } from '@/components/detail-parts'
import { EditorSheetContent } from '@/components/mappings/editor-sheet'
import { useGraphText } from '@/components/mappings/graph-text'
import { documentSize, documentText } from '@/components/mappings/mapping-preview'
import { ToolbarAction } from '@/components/mappings/toolbar-action'
import { useDraftPreview } from '@/components/mappings/use-draft-preview'
import { mappingSamplesQuery } from '@/lib/api/queries'
import {
  type DocumentContent,
  type MappingDraft,
  type MappingSample,
  type MappingTransform,
  type PreviewNote,
  previewNoteKey,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@edi-bridge/ui/components/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Sheet, SheetTrigger } from '@edi-bridge/ui/components/sheet'
import { cn } from '@edi-bridge/ui/lib/utils'

const views = ['target', 'source'] as const

export function PreviewFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('Mapping.preview.error')

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-800 dark:text-red-300">
        {message}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  )
}

export function DocumentText({
  label,
  document,
  busy = false,
  className,
}: {
  label: string
  document: DocumentContent
  busy?: boolean
  className?: string
}) {
  return (
    <pre
      role="region"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a long Document
      tabIndex={0}
      aria-busy={busy}
      aria-label={label}
      className={cn(
        'bg-muted/40 focus-visible:ring-ring/50 overflow-auto rounded-md border p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-3',
        className,
      )}>
      {documentText(document)}
    </pre>
  )
}

function DocumentView({
  label,
  document,
  busy = false,
  children,
}: {
  label: string
  document: DocumentContent | undefined
  busy?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-24 min-w-0 flex-1 flex-col">
      {children ??
        (document && (
          <DocumentText busy={busy} document={document} label={label} className="min-h-0 flex-1" />
        ))}
    </div>
  )
}

export function PreviewNotes({
  transforms,
  notes,
  heading: Heading = 'h3',
}: {
  transforms: ReadonlyArray<MappingTransform>
  notes: ReadonlyArray<PreviewNote>
  heading?: 'h3' | 'h5'
}) {
  const t = useTranslations('Mapping.preview.notes')
  const text = useGraphText(transforms)
  const headingId = useId()

  if (notes.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Heading id={headingId} className="text-sm font-medium">
        {t('title', { count: notes.length })}
      </Heading>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1 text-sm">
        {notes.map((note) => (
          <li key={previewNoteKey(note)} className="flex flex-wrap gap-x-2">
            <span className="font-mono text-xs leading-5">{note.targetPath}</span>
            <span className="text-muted-foreground">
              {t(note.code, { transform: note.transformId ? text.name(note.transformId) : '' })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SamplePreview({
  draft,
  samples,
  sample,
  onChoose,
}: {
  draft: MappingDraft
  samples: ReadonlyArray<MappingSample>
  sample: MappingSample
  onChoose: (id: string) => void
}) {
  const t = useTranslations('Mapping.preview')
  const labelId = useId()
  const { preview, key, settledKey, updating } = useDraftPreview(draft, sample.id)
  const [firstKey] = useState(() => `${sample.id}|${key}`)
  const [shown, setShown] = useState<(typeof views)[number]>('target')
  const changed = `${sample.id}|${settledKey}` !== firstKey

  // A polite message once each update has settled, never while the Mapping is still changing.
  const announcement =
    !updating && changed && preview.isSuccess ? t('updated', { name: sample.name }) : ''

  const items = samples.map(({ id, name }) => ({ value: id, label: name }))
  const shownDocument = shown === 'source' ? sample.document : preview.data?.document

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span id={labelId} className="text-sm font-medium">
            {t('sample')}
          </span>
          <Select
            items={items}
            value={sample.id}
            onValueChange={(value) => value && onChoose(value)}>
            <SelectTrigger aria-labelledby={labelId} className="w-64 max-w-full">
              <SelectValue className="min-w-0">
                {(value: string | null) => (
                  <span className="truncate">
                    {items.find((item) => item.value === value)?.label}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground flex min-h-8 items-center gap-1.5 text-sm">
          {updating && (
            <HugeiconsIcon
              icon={Loading03Icon}
              strokeWidth={2}
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          {preview.isSuccess && (updating ? t('updating') : t('upToDate'))}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div role="group" aria-label={t('shown')} className="flex flex-wrap gap-1">
          {views.map((view) => (
            <Button
              key={view}
              size="sm"
              variant={shown === view ? 'secondary' : 'ghost'}
              aria-pressed={shown === view}
              onClick={() => setShown(view)}>
              {t(view)}
            </Button>
          ))}
        </div>
        {shownDocument && (
          <span className="text-muted-foreground text-xs">
            {t('size', documentSize(shownDocument))}
          </span>
        )}
      </div>
      {shown === 'source' ? (
        <DocumentView document={sample.document} label={t('sourceLabel', { name: sample.name })} />
      ) : (
        <DocumentView
          busy={updating}
          document={preview.data?.document}
          label={t('targetLabel', { name: sample.name })}>
          {preview.isError ? (
            <PreviewFailure message={t('error.preview')} onRetry={() => void preview.refetch()} />
          ) : preview.isPending ? (
            <Loading label={t('building')} rowClassName="h-4" />
          ) : undefined}
        </DocumentView>
      )}
      {preview.data && <PreviewNotes notes={preview.data.notes} transforms={draft.transforms} />}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

function PreviewContent({
  draft,
  chosen,
  onChoose,
}: {
  draft: MappingDraft
  chosen: string | null
  onChoose: (id: string) => void
}) {
  const t = useTranslations('Mapping.preview')
  const samples = useQuery(mappingSamplesQuery(draft.mappingId))

  if (samples.isPending) {
    return <Loading label={t('loading')} rowClassName="h-4" />
  }

  if (samples.isError) {
    return <PreviewFailure message={t('error.samples')} onRetry={() => void samples.refetch()} />
  }

  const sample = samples.data.find(({ id }) => id === chosen) ?? samples.data[0]

  if (!sample) {
    return (
      <Empty className="p-6">
        <EmptyHeader>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return <SamplePreview draft={draft} sample={sample} samples={samples.data} onChoose={onChoose} />
}

// A modal sheet: the canvas keeps its full width, and the preview opens on the links as they are.
export function MappingPreviewSheet({
  draft,
  reviewSampleId = null,
}: {
  draft: MappingDraft
  reviewSampleId?: string | null
}) {
  const t = useTranslations('Mapping.preview')
  // Held here, not in the content, which unmounts while the sheet is closed. An AI review that
  // opens shows its example document, which the Admin may then change.
  const [chosen, setChosen] = useState<string | null>(reviewSampleId)
  const [review, setReview] = useState(reviewSampleId)

  if (review !== reviewSampleId) {
    setReview(reviewSampleId)

    if (reviewSampleId) {
      setChosen(reviewSampleId)
    }
  }

  return (
    <Sheet>
      <ToolbarAction
        icon={<HugeiconsIcon icon={ViewIcon} strokeWidth={2} aria-hidden />}
        label={t('title')}
        render={<SheetTrigger render={<Button variant="outline" />} />}
      />
      <EditorSheetContent
        bodyClassName="@container"
        closeLabel={t('close')}
        description={t('description')}
        title={t('title')}
        className="data-[side=right]:sm:max-w-2xl">
        <PreviewContent chosen={chosen} draft={draft} onChoose={setChosen} />
      </EditorSheetContent>
    </Sheet>
  )
}
