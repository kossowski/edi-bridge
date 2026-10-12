'use client'

import { File02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import { type KeyboardEvent, type Ref, useId } from 'react'

import {
  pathWithin,
  type SampleContent,
  type SampleSegment,
} from '@/components/document-structures/sample-segments'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { DocumentStructureSample } from '@edi-bridge/contracts'

type FieldLabels = ReadonlyMap<string, string>

function nextIndex(key: string, index: number, count: number) {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(index + 1, count - 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(index - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const container = event.currentTarget.closest('[data-sample-values]')
  const values = [...(container?.querySelectorAll<HTMLElement>('[data-sample-value]') ?? [])]
  const index = values.indexOf(event.currentTarget)
  const next = index === -1 ? null : nextIndex(event.key, index, values.length)

  if (next === null) {
    return
  }

  event.preventDefault()
  values[next]?.focus()
}

function Value({
  segment: { text, path },
  label,
  selected,
  tabStop,
  onSelect,
}: {
  segment: { text: string; path: string }
  label: string
  selected: boolean
  tabStop: boolean
  onSelect: (path: string) => void
}) {
  const t = useTranslations('DocumentStructure.sample')

  return (
    <button
      tabIndex={tabStop ? 0 : -1}
      type="button"
      aria-label={t('value', { value: text, field: label })}
      aria-pressed={selected}
      className="decoration-muted-foreground/70 hover:bg-primary/10 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-primary aria-pressed:ring-offset-background scroll-m-3 rounded-sm text-left underline decoration-dotted underline-offset-4 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid aria-pressed:font-semibold aria-pressed:no-underline aria-pressed:ring-2 aria-pressed:ring-offset-1"
      data-path={path}
      data-sample-value
      onClick={() => onSelect(path)}
      onKeyDown={moveFocus}>
      {text}
    </button>
  )
}

function tabStopIndex(
  segments: ReadonlyArray<SampleSegment>,
  labels: FieldLabels,
  selected: string | null,
) {
  const selectable = (segment: SampleSegment) =>
    segment.path !== null && segment.text !== '' && labels.has(segment.path)

  const chosen = segments.findIndex(
    (segment) =>
      selectable(segment) &&
      selected !== null &&
      segment.path !== null &&
      pathWithin(segment.path, selected),
  )

  return chosen === -1 ? segments.findIndex(selectable) : chosen
}

function JsonValues({
  segments,
  labels,
  selected,
  onSelect,
}: {
  segments: SampleSegment[]
  labels: FieldLabels
  selected: string | null
  onSelect: (path: string) => void
}) {
  const tabStop = tabStopIndex(segments, labels, selected)

  return (
    <pre className="p-3 font-mono text-xs leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
      {segments.map((segment, index) => {
        const label = segment.path === null ? undefined : labels.get(segment.path)

        return segment.path === null || label === undefined ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <Value
            key={index}
            label={label}
            segment={{ text: segment.text, path: segment.path }}
            selected={selected !== null && pathWithin(segment.path, selected)}
            tabStop={index === tabStop}
            onSelect={onSelect}
          />
        )
      })}
    </pre>
  )
}

function CsvValues({
  content,
  fileName,
  labels,
  selected,
  onSelect,
}: {
  content: Extract<SampleContent, { kind: 'csv' }>
  fileName: string
  labels: FieldLabels
  selected: string | null
  onSelect: (path: string) => void
}) {
  const t = useTranslations('DocumentStructure.sample')
  const cells = content.rows.flat()
  const tabStop = tabStopIndex(cells, labels, selected)
  let cellIndex = 0

  return (
    <div className="flex flex-col gap-2 p-3">
      <table aria-label={t('tableLabel', { fileName })} className="w-full text-xs">
        <TableHeader>
          <TableRow>
            {content.columns.map(({ path, name }) => (
              <TableHead
                key={path}
                scope="col"
                className="h-auto py-1.5 align-bottom whitespace-normal">
                <span className="flex flex-col">
                  <span className="font-medium">{labels.get(path) ?? name}</span>
                  <code className="text-muted-foreground font-mono font-normal">{name}</code>
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {content.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, column) => {
                const index = cellIndex++
                const label = cell.path === null ? undefined : labels.get(cell.path)

                return (
                  <TableCell key={column} className="py-1.5 font-mono">
                    {cell.path === null || label === undefined || cell.text === '' ? (
                      cell.text
                    ) : (
                      <Value
                        label={label}
                        segment={{ text: cell.text, path: cell.path }}
                        selected={selected !== null && pathWithin(cell.path, selected)}
                        tabStop={index === tabStop}
                        onSelect={onSelect}
                      />
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </table>
      {content.rowCount > content.rows.length && (
        <p className="text-muted-foreground text-xs">
          {t('rows', { shown: content.rows.length, total: content.rowCount })}
        </p>
      )}
    </div>
  )
}

export function SampleFile({
  content,
  sample,
  labels,
  selected,
  onSelect,
  valuesRef,
}: {
  content: SampleContent
  sample: DocumentStructureSample
  labels: FieldLabels
  selected: string | null
  onSelect: (path: string) => void
  valuesRef?: Ref<HTMLDivElement>
}) {
  const t = useTranslations('DocumentStructure.sample')
  const format = useFormatter()
  const hintId = useId()
  const takenAt = new Date(sample.takenAt)

  return (
    <figure className="bg-card flex min-w-0 flex-col overflow-hidden rounded-xl border lg:max-h-[calc(100svh-6rem)]">
      <figcaption className="bg-muted/50 flex flex-col gap-1 border-b px-3 py-2 text-xs">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <HugeiconsIcon icon={File02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
          <span className="min-w-0 font-medium break-all">
            <span className="sr-only">{t('title')}: </span>
            {sample.fileName}
          </span>
          <time
            dateTime={sample.takenAt}
            title={format.dateTime(takenAt, { dateStyle: 'medium', timeStyle: 'short' })}
            className="text-muted-foreground ml-auto">
            {t('takenAt', { date: format.dateTime(takenAt, { dateStyle: 'medium' }) })}
          </time>
        </span>
        <span id={hintId} className="text-muted-foreground">
          {content.kind === 'text' ? t('unreadable') : t('hint')}
        </span>
      </figcaption>
      {content.kind === 'text' ? (
        <pre
          role="region"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll the file
          tabIndex={0}
          aria-label={t('valuesLabel', { fileName: sample.fileName })}
          className="focus-visible:ring-ring/50 max-h-[32rem] overflow-auto p-3 font-mono text-xs leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap outline-none focus-visible:ring-3 focus-visible:ring-inset">
          {sample.text}
        </pre>
      ) : (
        <div
          ref={valuesRef}
          role="group"
          aria-describedby={hintId}
          aria-label={t('valuesLabel', { fileName: sample.fileName })}
          className={cn(
            'max-h-[32rem] min-h-0 overflow-auto lg:max-h-none',
            content.kind === 'csv' && 'scroll-shadow-x',
          )}
          data-sample-values>
          {content.kind === 'json' ? (
            <JsonValues
              labels={labels}
              segments={content.segments}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <CsvValues
              content={content}
              fileName={sample.fileName}
              labels={labels}
              selected={selected}
              onSelect={onSelect}
            />
          )}
        </div>
      )}
    </figure>
  )
}

export function scrollToValue(container: HTMLElement | null, path: string) {
  const values = [...(container?.querySelectorAll('[data-sample-value]') ?? [])]
  const first = values.find((value) => pathWithin(value.getAttribute('data-path') ?? '', path))

  first?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function scrollToField(list: HTMLElement | null, path: string) {
  list
    ?.querySelector(`[data-path="${CSS.escape(path)}"]`)
    ?.closest('li')
    ?.scrollIntoView({ block: 'nearest' })
}
