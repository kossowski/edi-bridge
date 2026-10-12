'use client'

import {
  Add01Icon,
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Table01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { UsesList } from '@/components/code-translations/lookup-table-card'
import {
  type Fix,
  fixesOf,
  hasValue,
  matchesFilter,
  restoredEntry,
  runsToReprocess,
  tableDirection,
  withEntry,
  withFixes,
  withoutEntry,
} from '@/components/code-translations/lookup-table-entries'
import { MissingCodes, RunLinks } from '@/components/code-translations/missing-codes'
import {
  type AddDraft,
  AddValueForm,
  focusOnMount,
  ValueRow,
} from '@/components/code-translations/value-row'
import { ActionError } from '@/components/documents/action-error'
import { useRunTitle } from '@/components/documents/run-title'
import { toScopeInput } from '@/components/lookup-tables/lookup-table-scope'
import { updateLookupTable } from '@/lib/api/client'
import { storeSavedLookupTable } from '@/lib/api/queries'
import { documentHref } from '@/lib/navigation'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent } from '@edi-bridge/ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  Direction,
  FailedRunReference,
  LookupTable,
  LookupTableEntry,
  LookupTableKind,
  MissingCode,
} from '@edi-bridge/contracts'

type Removed = { entry: LookupTableEntry; index: number }

export type FixedCodes = { tableId: string; fixes: Fix[]; key: number; focus: boolean }

export type RecordFixes = (
  missingBefore: ReadonlyArray<MissingCode>,
  saved: LookupTable,
  focus: boolean,
) => boolean

export function openMissingCodes(
  missing: ReadonlyArray<MissingCode> | undefined,
  entries: ReadonlyArray<LookupTableEntry>,
) {
  return missing?.filter(({ code }) => !hasValue(entries, code))
}

export function useFixedCodes() {
  const [fixed, setFixed] = useState<FixedCodes | null>(null)

  const record: RecordFixes = (missingBefore, saved, focus) => {
    const fixes = fixesOf(missingBefore, saved.entries)

    if (fixes.length === 0) {
      return false
    }

    setFixed((current) => ({
      tableId: saved.id,
      fixes: withFixes(current?.tableId === saved.id ? current.fixes : [], fixes),
      key: (current?.key ?? 0) + 1,
      focus,
    }))

    return true
  }

  return { fixed, record }
}

function useSaveEntries(table: LookupTable) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entries: LookupTableEntry[]) =>
      updateLookupTable(table.id, {
        name: table.name,
        kind: table.kind,
        scope: toScopeInput(table.scope),
        entries,
      }),
    onSuccess: (saved) => storeSavedLookupTable(queryClient, saved),
  })
}

function meaningsOf(table: LookupTable, missingCodes: ReadonlyArray<MissingCode>) {
  return new Map([
    ...missingCodes.flatMap(({ suggestions }) =>
      suggestions.map(({ code, meaning }) => [code, meaning] as const),
    ),
    ...table.codeMeanings.map(({ code, meaning }) => [code, meaning] as const),
  ])
}

function revealAndFocus(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'center' })
  element?.focus({ preventScroll: true })
}

function ReprocessLink({ run, focus }: { run: FailedRunReference; focus: boolean }) {
  const t = useTranslations('CodeTranslation.fixed')
  const runTitle = useRunTitle(run)

  return (
    <Link
      href={documentHref(run.id)}
      ref={focus ? revealAndFocus : undefined}
      className={cn(
        buttonVariants({ size: 'sm' }),
        'h-auto min-h-7 w-fit max-w-full py-1 text-left whitespace-normal',
      )}>
      {t('reprocess', { document: runTitle })}
    </Link>
  )
}

function OtherRuns({ runs }: { runs: ReadonlyArray<FailedRunReference> }) {
  const t = useTranslations('CodeTranslation.fixed')
  const othersId = useId()
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant="link"
        aria-controls={othersId}
        aria-expanded={expanded}
        className="text-foreground h-auto min-h-6 w-fit p-0 underline"
        onClick={() => setExpanded(!expanded)}>
        {t('more', { count: runs.length })}
      </Button>
      <div id={othersId} hidden={!expanded} className="flex flex-col gap-1">
        {expanded && <RunLinks runs={runs} />}
      </div>
    </>
  )
}

function FixedAlert({
  fixed,
  direction,
  originRunId,
}: {
  fixed: FixedCodes
  direction: Direction
  originRunId: string | undefined
}) {
  const t = useTranslations('CodeTranslation.fixed')
  const format = useFormatter()
  const [first, ...others] = runsToReprocess(fixed.fixes, originRunId)
  const [onlyFix] = fixed.fixes

  const title =
    fixed.fixes.length === 1 && onlyFix
      ? t('title', { direction, code: onlyFix.code, target: onlyFix.targetCode })
      : t('titleMany', { codes: format.list(fixed.fixes.map(({ code }) => code)) })

  return (
    <Alert role="status" variant="success" className="scroll-mt-20">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{t('description', { count: others.length + 1 })}</p>
        {first && <ReprocessLink focus={fixed.focus} run={first} />}
        {others.length > 0 && <OtherRuns runs={others} />}
      </AlertDescription>
    </Alert>
  )
}

function RemovedNotice({
  removed,
  direction,
  saving,
  onUndo,
}: {
  removed: Removed
  direction: Direction
  saving: boolean
  onUndo: () => void
}) {
  const t = useTranslations('CodeTranslation.values')
  const textId = useId()

  return (
    <div
      role="status"
      className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <span id={textId}>
        {t('removed', {
          direction,
          code: removed.entry.sourceCode,
          target: removed.entry.targetCode,
        })}
      </span>
      <Button
        disabled={saving}
        ref={focusOnMount}
        size="sm"
        variant="outline"
        aria-describedby={textId}
        onClick={onUndo}>
        {t('undo')}
      </Button>
    </div>
  )
}

function EmptyValues({ kind, canChange }: { kind: LookupTableKind; canChange: boolean }) {
  const t = useTranslations('CodeTranslation.values.empty')

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Table01Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>
          {canChange ? t('description', { kind }) : t('viewOnlyDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Uses({ table }: { table: LookupTable }) {
  const t = useTranslations('CodeTranslation.uses')

  return (
    <aside>
      <Card size="sm">
        <CardContent>
          {table.uses.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('unused')}</p>
          ) : (
            <UsesList showAll uses={table.uses} />
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

export function LookupTableValues({
  table,
  missing,
  canChange,
  requestedCode,
  originRunId,
  fixed,
  onFixed,
}: {
  table: LookupTable
  missing: UseQueryResult<MissingCode[]>
  canChange: boolean
  requestedCode: string | undefined
  originRunId: string | undefined
  fixed: FixedCodes | null
  onFixed: RecordFixes
}) {
  const t = useTranslations('CodeTranslation.values')
  const valuesId = useId()
  const filterId = useId()
  const direction = tableDirection(table.uses)
  const requestedExists = requestedCode !== undefined && hasValue(table.entries, requestedCode)
  const nextKey = useRef(1)
  const [adding, setAdding] = useState<AddDraft | null>(null)
  const [requestHandled, setRequestHandled] = useState(false)
  const [highlight, setHighlight] = useState(requestedExists ? requestedCode : null)
  const [focusRequest, setFocusRequest] = useState<{ code: string; id: number } | null>(null)
  const [removed, setRemoved] = useState<Removed | null>(null)
  const [filter, setFilter] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const save = useSaveEntries(table)
  const missingCodes = openMissingCodes(missing.data, table.entries) ?? []
  const meanings = meaningsOf(table, missingCodes)
  const meaningOf = (code: string) => meanings.get(code) ?? null
  const term = filter.trim().toLocaleLowerCase()

  const requestedIsMissing =
    requestedCode !== undefined && missingCodes.some(({ code }) => code === requestedCode)

  const addsRequestedCode =
    canChange &&
    requestedCode !== undefined &&
    !requestHandled &&
    !requestedExists &&
    (missing.isError || (missing.isSuccess && !requestedIsMissing))

  const addForm = adding ?? (addsRequestedCode ? { key: 0, sourceCode: requestedCode } : null)

  const visible = table.entries.flatMap((entry, index) =>
    matchesFilter(entry, term) ? [{ entry, index }] : [],
  )

  function suggestionsOf(code: string) {
    return missingCodes.find((missingCode) => missingCode.code === code)?.suggestions ?? []
  }

  function startAdding(sourceCode: string) {
    save.reset()
    setFocusRequest(null)
    setRequestHandled(true)
    setAdding({ key: nextKey.current++, sourceCode })
  }

  function markSaved(sourceCode: string, focus: boolean) {
    setHighlight(sourceCode)
    setFocusRequest(focus ? { code: sourceCode, id: nextKey.current++ } : null)
    setAnnouncement(t('saved', { code: sourceCode }))
  }

  function saveEntries(
    entries: LookupTableEntry[],
    { focusFix, onSaved }: { focusFix: boolean; onSaved: (fixed: boolean) => void },
  ) {
    const missingBefore = missingCodes

    save.mutate(entries, {
      onSuccess: (saved) => onSaved(onFixed(missingBefore, saved, focusFix)),
    })
  }

  function add(entry: LookupTableEntry) {
    saveEntries(withEntry(table.entries, entry, null), {
      focusFix: true,
      onSaved: (fixedCode) => {
        setAdding(null)
        setRequestHandled(true)
        setRemoved(null)
        markSaved(entry.sourceCode, !fixedCode)
      },
    })
  }

  function edit(index: number, entry: LookupTableEntry, done: () => void) {
    saveEntries(withEntry(table.entries, entry, index), {
      focusFix: false,
      onSaved: () => {
        done()
        setRemoved(null)
        markSaved(entry.sourceCode, true)
      },
    })
  }

  function remove(index: number) {
    const entry = table.entries[index]

    if (!entry) {
      return
    }

    save.mutate(withoutEntry(table.entries, index), {
      onSuccess: () => {
        setRemoved({ entry, index })
        setHighlight(null)
        setFocusRequest(null)
      },
    })
  }

  function undo() {
    if (!removed) {
      return
    }

    saveEntries(restoredEntry(table.entries, removed.entry, removed.index), {
      focusFix: false,
      onSaved: () => {
        setRemoved(null)
        markSaved(removed.entry.sourceCode, true)
        setAnnouncement(t('restored', { code: removed.entry.sourceCode }))
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {fixed && fixed.tableId === table.id && (
        <FixedAlert key={fixed.key} direction={direction} fixed={fixed} originRunId={originRunId} />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <MissingCodes
            codes={missing.data && missingCodes}
            direction={direction}
            entries={table.entries}
            highlighted={requestedIsMissing ? requestedCode : null}
            isError={missing.isError}
            isPending={missing.isPending}
            meaningOf={meaningOf}
            saving={save.isPending}
            onAccept={canChange ? add : null}
          />
          <section aria-labelledby={valuesId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id={valuesId} className="text-base font-semibold">
                  {t('title')}{' '}
                  <span className="text-muted-foreground font-normal tabular-nums">
                    ({table.entries.length})
                  </span>
                </h2>
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <span>{t('source', { direction })}</span>
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    strokeWidth={2}
                    aria-label={t('arrow', { direction })}
                    className="size-4"
                  />
                  <span>{t('target', { direction })}</span>
                </p>
              </div>
              {canChange && addForm === null && (
                <Button variant="outline" onClick={() => startAdding('')}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
                  {t('add')}
                </Button>
              )}
            </div>
            {addForm && (
              <AddValueForm
                key={addForm.key}
                direction={direction}
                entries={table.entries}
                initial={addForm}
                meaningOf={meaningOf}
                saving={save.isPending}
                suggestionsOf={suggestionsOf}
                onAdd={add}
                onCancel={() => {
                  save.reset()
                  setAdding(null)
                  setRequestHandled(true)
                }}
              />
            )}
            {save.isError && <ActionError message={t('errors.saveFailed')} />}
            {removed && (
              <RemovedNotice
                key={`${removed.entry.sourceCode}-${removed.index}`}
                direction={direction}
                removed={removed}
                saving={save.isPending}
                onUndo={undo}
              />
            )}
            {table.entries.length === 0 ? (
              <EmptyValues canChange={canChange} kind={table.kind} />
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex w-full flex-col gap-1.5 sm:w-72">
                    <label htmlFor={filterId} className="text-sm font-medium">
                      {t('filter')}
                    </label>
                    <Input
                      id={filterId}
                      type="search"
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value)
                        setFocusRequest(null)
                      }}
                    />
                  </div>
                  {term !== '' && (
                    <p aria-live="polite" className="text-muted-foreground text-sm">
                      {t('filteredCount', { count: visible.length, total: table.entries.length })}
                    </p>
                  )}
                </div>
                {visible.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border px-2 py-6 text-center text-sm">
                    {t('noMatch')}
                  </p>
                ) : (
                  <ul
                    aria-labelledby={valuesId}
                    className="bg-card divide-y rounded-xl border px-2">
                    {visible.map(({ entry, index }) => (
                      <ValueRow
                        key={entry.sourceCode}
                        canChange={canChange}
                        direction={direction}
                        entries={table.entries}
                        entry={entry}
                        focusRequest={
                          focusRequest?.code === entry.sourceCode ? focusRequest.id : null
                        }
                        highlighted={highlight === entry.sourceCode}
                        index={index}
                        meaningOf={meaningOf}
                        saving={save.isPending}
                        onRemove={() => remove(index)}
                        onSave={(edited, done) => edit(index, edited, done)}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
        <Uses table={table} />
      </div>
    </div>
  )
}
