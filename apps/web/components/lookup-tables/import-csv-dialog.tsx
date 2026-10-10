'use client'

import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { describedBy, FormField } from '@/components/form-field'
import {
  checkCsv,
  countByStatus,
  type CsvError,
  hasChanges,
  type ImportCounts,
  type ImportFilter,
  importStatuses,
  previewPageSize,
  rowsWithStatus,
} from '@/components/lookup-tables/lookup-table-import'
import { errorTextClass } from '@/components/lookup-tables/lookup-table-styles'
import { importLookupTable, previewLookupTableImport } from '@/lib/api/client'
import { lookupTableKeys, storeSavedLookupTable } from '@/lib/api/queries'
import {
  type LookupTable,
  type LookupTableImportReason,
  type LookupTableImportRow,
  type LookupTableImportStatus,
  maxLookupCodeLength,
  maxLookupTableCsvLength,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@edi-bridge/ui/components/dialog'
import { Input } from '@edi-bridge/ui/components/input'
import { Textarea } from '@edi-bridge/ui/components/textarea'
import { cn } from '@edi-bridge/ui/lib/utils'

type SourceError = CsvError | 'readFailed'

type Preview = { csv: string; rows: LookupTableImportRow[] }

const emptyStateClass = 'text-muted-foreground rounded-lg border px-2 py-6 text-center'

const statusStyles: Record<LookupTableImportStatus, string> = {
  added: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  changed: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  unchanged: 'border-border text-foreground',
  invalid: 'bg-red-500/10 text-red-800 dark:text-red-300',
}

function StatusBadge({ status }: { status: LookupTableImportStatus }) {
  const t = useTranslations('LookupTable.import.statuses')

  return (
    <Badge variant="outline" className={statusStyles[status]}>
      {t(status)}
    </Badge>
  )
}

function UnsavedNotice({ onDiscard }: { onDiscard: () => void }) {
  const t = useTranslations('LookupTable.import')

  return (
    <>
      <div className="flex flex-col gap-1 rounded-lg border p-3">
        <p className="font-medium">{t('unsaved.title')}</p>
        <p className="text-muted-foreground">{t('unsaved.description')}</p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
        <Button variant="destructive" onClick={onDiscard}>
          {t('unsaved.discard')}
        </Button>
      </DialogFooter>
    </>
  )
}

function CsvSource({
  csv,
  error,
  focusOnMount,
  previewing,
  previewFailed,
  onChange,
  onError,
  onSubmit,
}: {
  csv: string
  error: SourceError | null
  focusOnMount: boolean
  previewing: boolean
  previewFailed: boolean
  onChange: (csv: string) => void
  onError: (error: SourceError) => void
  onSubmit: () => void
}) {
  const t = useTranslations('LookupTable.import')
  const id = useId()
  const fileId = `${id}-file`
  const textId = `${id}-text`
  const errorText = error && t(`errors.${error}`, { max: maxLookupTableCsvLength })
  const fileError = error === 'readFailed' ? errorText : null
  const textError = error === 'readFailed' ? null : errorText

  async function read(file: File | undefined) {
    if (!file) {
      return
    }

    try {
      onChange(await file.text())
    } catch {
      onError('readFailed')
    }
  }

  useLayoutEffect(() => {
    if (focusOnMount) {
      document.getElementById(fileId)?.focus()
    }
  }, [focusOnMount, fileId])

  useEffect(() => {
    if (error) {
      document.getElementById(error === 'readFailed' ? fileId : textId)?.focus()
    }
  }, [error, fileId, textId])

  return (
    <form
      noValidate
      aria-busy={previewing}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}>
      <FormField
        id={fileId}
        description={t('file.description')}
        error={fileError}
        label={
          <label htmlFor={fileId} className="text-sm font-medium">
            {t('file.label')}
          </label>
        }>
        <Input
          id={fileId}
          accept=".csv,text/csv,text/plain"
          type="file"
          aria-describedby={describedBy(fileId, fileError)}
          aria-invalid={fileError !== null}
          className="h-auto py-1.5"
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </FormField>
      <FormField
        id={textId}
        description={t('text.description')}
        error={textError}
        label={
          <label htmlFor={textId} className="text-sm font-medium">
            {t('text.label')}
          </label>
        }>
        <Textarea
          id={textId}
          rows={8}
          spellCheck={false}
          value={csv}
          aria-describedby={describedBy(textId, textError)}
          aria-invalid={textError !== null}
          className="[field-sizing:fixed] h-48 font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
      </FormField>
      {previewFailed && (
        <p role="alert" className={errorTextClass}>
          {t('errors.previewFailed')}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
        <Button disabled={previewing} type="submit">
          {previewing ? t('previewing') : t('preview')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Reasons({
  reasons,
  className,
}: {
  reasons: ReadonlyArray<LookupTableImportReason>
  className?: string
}) {
  const t = useTranslations('LookupTable.import.reasons')

  return (
    <ul className={cn('flex flex-col gap-0.5', className)}>
      {reasons.map((reason) => (
        <li key={reason}>{t(reason, { max: maxLookupCodeLength })}</li>
      ))}
    </ul>
  )
}

function Codes({ row }: { row: LookupTableImportRow }) {
  const t = useTranslations('LookupTable.import')

  if (row.status === 'invalid') {
    return (
      <td colSpan={2} className="px-2 py-1.5">
        <span className="sr-only">{t('result.invalidCells')}: </span>
        <span className="flex flex-wrap gap-1">
          {row.cells.map((cell, index) => (
            <span key={index} className="bg-muted rounded px-1 font-mono break-all">
              {cell === '' ? '""' : cell}
            </span>
          ))}
        </span>
        <div className="mt-1 sm:hidden">
          <span className="sr-only">{t('columns.details')}: </span>
          <Reasons reasons={row.reasons} />
        </div>
      </td>
    )
  }

  return (
    <>
      <td className="px-2 py-1.5 font-mono break-all">{row.sourceCode}</td>
      <td className="px-2 py-1.5 font-mono break-all">
        {row.status === 'changed' ? (
          <>
            <span aria-hidden>
              <s className="text-muted-foreground">{row.previousTargetCode}</s> → {row.targetCode}
            </span>
            <span className="sr-only">
              {t('result.changedTarget', {
                previous: row.previousTargetCode,
                next: row.targetCode,
              })}
            </span>
          </>
        ) : (
          row.targetCode
        )}
      </td>
    </>
  )
}

function PreviewTable({
  rows,
  focusIndex,
}: {
  rows: ReadonlyArray<LookupTableImportRow>
  focusIndex: number | null
}) {
  const t = useTranslations('LookupTable.import')
  const captionId = useId()
  const focusRow = useRef<HTMLTableRowElement>(null)
  const headerClass = 'bg-popover sticky top-0 px-2 py-2 text-left font-medium'

  useLayoutEffect(() => {
    if (focusIndex !== null) {
      focusRow.current?.focus()
    }
  }, [focusIndex])

  return (
    <div
      role="region"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a long preview
      tabIndex={0}
      aria-labelledby={captionId}
      className="focus-visible:ring-ring/50 max-h-[40vh] overflow-auto rounded-lg border outline-none focus-visible:ring-3">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption id={captionId} className="sr-only">
          {t('result.lines')}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={cn(headerClass, 'w-12 border-b sm:w-16')}>
              {t('columns.line')}
            </th>
            <th scope="col" className={cn(headerClass, 'border-b sm:w-28')}>
              {t('columns.status')}
            </th>
            <th scope="col" className={cn(headerClass, 'border-b')}>
              {t('columns.sourceCode')}
            </th>
            <th scope="col" className={cn(headerClass, 'border-b')}>
              {t('columns.targetCode')}
            </th>
            <th scope="col" className={cn(headerClass, 'hidden border-b sm:table-cell')}>
              {t('columns.details')}
            </th>
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&>tr:last-child_td]:border-b-0">
          {rows.map((row, index) => (
            <tr
              key={row.line}
              ref={index === focusIndex ? focusRow : undefined}
              tabIndex={index === focusIndex ? -1 : undefined}
              className="focus-visible:outline-ring align-top outline-none focus-visible:outline-2 focus-visible:-outline-offset-2">
              <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
              <td className="px-2 py-1.5">
                <StatusBadge status={row.status} />
              </td>
              <Codes row={row} />
              <td className="hidden px-2 py-1.5 sm:table-cell">
                {row.status === 'invalid' && <Reasons reasons={row.reasons} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImportPreview({
  rows,
  applying,
  applyFailed,
  onBack,
  onApply,
}: {
  rows: ReadonlyArray<LookupTableImportRow>
  applying: boolean
  applyFailed: boolean
  onBack: () => void
  onApply: () => void
}) {
  const t = useTranslations('LookupTable.import')
  const format = useFormatter()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [filter, setFilter] = useState<ImportFilter>('all')
  const [limit, setLimit] = useState(previewPageSize)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const counts = countByStatus(rows)
  const filtered = rowsWithStatus(rows, filter)
  const shown = filtered.slice(0, limit)
  const remaining = filtered.length - shown.length

  const filters: ReadonlyArray<{ value: ImportFilter; label: string; count: number }> = [
    { value: 'all', label: t('result.all'), count: rows.length },
    ...importStatuses.map((status) => ({
      value: status,
      label: t(`statuses.${status}`),
      count: counts[status],
    })),
  ]

  useLayoutEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} ref={heading} tabIndex={-1} className="font-medium outline-none">
          {t('result.title')}
        </h3>
        <p className="text-muted-foreground">{t('result.description')}</p>
      </div>
      {rows.length === 0 ? (
        <p className={emptyStateClass}>{t('result.noLines')}</p>
      ) : (
        <>
          <div role="group" aria-label={t('result.filter')} className="flex flex-wrap gap-2">
            {filters.map(({ value, label, count }) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'secondary' : 'outline'}
                aria-pressed={filter === value}
                className="aria-pressed:ring-foreground/20 aria-pressed:ring-1"
                onClick={() => {
                  setFilter(value)
                  setLimit(previewPageSize)
                  setFocusIndex(null)
                }}>
                {label}
                <span className="tabular-nums">{format.number(count)}</span>
              </Button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className={emptyStateClass}>{t('result.noMatch')}</p>
          ) : (
            <PreviewTable focusIndex={focusIndex} rows={shown} />
          )}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-muted-foreground">
                {t('result.showing', { shown: shown.length, total: filtered.length })}
              </p>
              {remaining > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLimit(limit + previewPageSize)

                    if (remaining <= previewPageSize) {
                      setFocusIndex(shown.length)
                    }
                  }}>
                  {t('result.showMore', { count: Math.min(remaining, previewPageSize) })}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {!hasChanges(counts) && rows.length > 0 && (
        <p className="text-muted-foreground">{t('result.nothingToApply')}</p>
      )}
      {applyFailed && (
        <p role="alert" className={errorTextClass}>
          {t('errors.applyFailed')}
        </p>
      )}
      <DialogFooter>
        <Button disabled={applying} variant="outline" onClick={onBack}>
          {t('back')}
        </Button>
        <DialogClose disabled={applying} render={<Button variant="outline" />}>
          {t('cancel')}
        </DialogClose>
        <Button disabled={applying || !hasChanges(counts)} onClick={onApply}>
          {applying ? t('applying') : t('apply')}
        </Button>
      </DialogFooter>
    </section>
  )
}

function ImportSteps({
  tableId,
  focusOnMount,
  onImported,
}: {
  tableId: string
  focusOnMount: boolean
  onImported: (imported: LookupTable, counts: ImportCounts) => void
}) {
  const queryClient = useQueryClient()
  const [csv, setCsv] = useState('')
  const [sourceError, setSourceError] = useState<SourceError | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [backFromPreview, setBackFromPreview] = useState(false)

  const previewing = useMutation({
    mutationFn: (text: string) => previewLookupTableImport(tableId, { csv: text }),
    onSuccess: ({ rows }, text) => setPreview({ csv: text, rows }),
  })

  const applying = useMutation({
    mutationKey: lookupTableKeys.import(tableId),
    mutationFn: ({ csv: text }: Preview) => importLookupTable(tableId, { csv: text }),
    onSuccess: (imported, { rows }) => {
      storeSavedLookupTable(queryClient, imported)
      onImported(imported, countByStatus(rows))
    },
  })

  if (preview) {
    return (
      <ImportPreview
        applyFailed={applying.isError}
        applying={applying.isPending}
        rows={preview.rows}
        onApply={() => applying.mutate(preview)}
        onBack={() => {
          applying.reset()
          setPreview(null)
          setBackFromPreview(true)
        }}
      />
    )
  }

  return (
    <CsvSource
      csv={csv}
      error={sourceError}
      focusOnMount={focusOnMount || backFromPreview}
      previewFailed={previewing.isError}
      previewing={previewing.isPending}
      onChange={(text) => {
        setCsv(text)
        setSourceError(null)
      }}
      onError={setSourceError}
      onSubmit={() => {
        const error = checkCsv(csv)
        setSourceError(error)

        if (error === null) {
          previewing.mutate(csv)
        }
      }}
    />
  )
}

export function ImportCsvDialog({
  table,
  dirty,
  open,
  finalFocus,
  onOpenChange,
  onDiscard,
  onImported,
}: {
  table: Pick<LookupTable, 'id'>
  dirty: boolean
  open: boolean
  finalFocus?: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
  onImported: (imported: LookupTable, counts: ImportCounts) => void
}) {
  const t = useTranslations('LookupTable.import')
  const [resetKey, setResetKey] = useState(0)
  const [discarded, setDiscarded] = useState(false)
  const applying = useIsMutating({ mutationKey: lookupTableKeys.import(table.id) }) > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !applying) {
          onOpenChange(next)
        }
      }}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((count) => count + 1)
          setDiscarded(false)
        }
      }}>
      <DialogContent
        closeLabel={t('close')}
        finalFocus={finalFocus}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {dirty ? (
          <UnsavedNotice
            onDiscard={() => {
              setDiscarded(true)
              onDiscard()
            }}
          />
        ) : (
          <ImportSteps
            key={resetKey}
            focusOnMount={discarded}
            tableId={table.id}
            onImported={onImported}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
