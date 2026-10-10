'use client'

import { ArrowDown01Icon, ArrowUp01Icon, Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useState } from 'react'

import { useGraphText } from '@/components/mappings/graph-text'
import { documentText, lineCount, previewGraph } from '@/components/mappings/mapping-preview'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { mappingPreviewQuery, mappingSamplesQuery } from '@/lib/api/queries'
import {
  type DocumentContent,
  type MappingDraft,
  type MappingSample,
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
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

// Long enough that typing into a transform's form does not send a preview per keystroke.
const previewDelay = 600

const formats = { json: 'JSON', edifact: 'EDIFACT' } as const

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
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

function Loading({ label }: { label: string }) {
  return (
    <div aria-busy className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        {label}
      </p>
      {Array.from({ length: 6 }, (_, row) => (
        <Skeleton key={row} className="h-4 w-full" />
      ))}
    </div>
  )
}

function DocumentView({
  title,
  label,
  document,
  busy = false,
  children,
}: {
  title: string
  label: string
  document: DocumentContent | undefined
  busy?: boolean
  children?: React.ReactNode
}) {
  const t = useTranslations('Mapping.preview')
  const text = document ? documentText(document) : ''

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {document && (
          <span className="text-muted-foreground text-xs">
            {t('size', { format: formats[document.format], count: lineCount(text) })}
          </span>
        )}
      </div>
      {children ??
        (document && (
          <pre
            role="region"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a long Document
            tabIndex={0}
            aria-busy={busy}
            aria-label={label}
            className="bg-muted/40 focus-visible:ring-ring/50 min-h-0 flex-1 overflow-auto rounded-md border p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-3">
            {text}
          </pre>
        ))}
    </div>
  )
}

function Notes({ draft, notes }: { draft: MappingDraft; notes: ReadonlyArray<PreviewNote> }) {
  const t = useTranslations('Mapping.preview.notes')
  const text = useGraphText(draft.transforms)
  const headingId = useId()

  if (notes.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 id={headingId} className="text-sm font-medium">
        {t('title', { count: notes.length })}
      </h3>
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
  const graph = useMemo(() => previewGraph(draft), [draft])
  const key = useMemo(() => JSON.stringify(graph), [graph])
  const settled = useDebouncedValue(graph, key, previewDelay)
  const preview = useQuery(mappingPreviewQuery(draft.mappingId, sample.id, settled.value))
  const updating = settled.pending || preview.isFetching
  const [firstKey] = useState(() => `${sample.id}|${key}`)
  const changed = `${sample.id}|${settled.key}` !== firstKey

  // A polite message once each update has settled, never while the Mapping is still changing.
  const announcement =
    !updating && changed && preview.isSuccess ? t('updated', { name: sample.name }) : ''

  const items = samples.map(({ id, name }) => ({ value: id, label: name }))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span id={labelId} className="text-sm font-medium">
            {t('sample')}
          </span>
          <Select
            items={items}
            value={sample.id}
            onValueChange={(value) => value && onChoose(value)}>
            <SelectTrigger aria-labelledby={labelId} className="w-80 max-w-full">
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
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
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
      <div className="grid min-h-40 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4">
        <DocumentView
          document={sample.document}
          label={t('sourceLabel', { name: sample.name })}
          title={t('source')}
        />
        <DocumentView
          busy={updating}
          document={preview.data?.document}
          label={t('targetLabel', { name: sample.name })}
          title={t('target')}>
          {preview.isError ? (
            <Failure message={t('error.preview')} onRetry={() => void preview.refetch()} />
          ) : preview.isPending ? (
            <Loading label={t('building')} />
          ) : undefined}
        </DocumentView>
      </div>
      {preview.data && <Notes draft={draft} notes={preview.data.notes} />}
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
    return <Loading label={t('loading')} />
  }

  if (samples.isError) {
    return <Failure message={t('error.samples')} onRetry={() => void samples.refetch()} />
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

// Collapsible, so the canvas can have the room back while the preview is not needed. Open, it keeps
// a bounded height and scrolls inside, so the canvas above stays in view while the admin edits.
export function MappingPreviewPanel({ draft }: { draft: MappingDraft }) {
  const t = useTranslations('Mapping.preview')
  const [open, setOpen] = useState(true)
  // Held here, not in the content, which unmounts while the panel is collapsed.
  const [chosen, setChosen] = useState<string | null>(null)
  const headingId = useId()
  const contentId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'bg-card flex shrink-0 flex-col rounded-lg border',
        open && 'h-[clamp(14rem,32svh,24rem)]',
      )}>
      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
        <h2 id={headingId} className="text-sm font-semibold">
          {t('title')}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          aria-controls={contentId}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}>
          <HugeiconsIcon
            icon={open ? ArrowDown01Icon : ArrowUp01Icon}
            strokeWidth={2}
            aria-hidden
          />
          {open ? t('hide') : t('show')}
        </Button>
      </div>
      <div
        id={contentId}
        hidden={!open}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t px-4 py-3">
        {open && <PreviewContent chosen={chosen} draft={draft} onChoose={setChosen} />}
      </div>
    </section>
  )
}
