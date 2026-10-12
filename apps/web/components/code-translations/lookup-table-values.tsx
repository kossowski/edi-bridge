'use client'

import {
  Add01Icon,
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Table01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'

import { UsesList } from '@/components/code-translations/lookup-table-card'
import {
  hasValue,
  matchesFilter,
  restoredEntry,
  withEntry,
  withoutEntry,
} from '@/components/code-translations/lookup-table-entries'
import { FailedRunLink, MissingCodes } from '@/components/code-translations/missing-codes'
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
import { Button } from '@edi-bridge/ui/components/button'
import { Card, CardContent } from '@edi-bridge/ui/components/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'

import type {
  BlockingMissingCode,
  FailedRunReference,
  LookupTable,
  LookupTableEntry,
  MissingCode,
} from '@edi-bridge/contracts'

type Removed = { entry: LookupTableEntry; index: number }

type Fixed = { code: string; targetCode: string; failedRuns: ReadonlyArray<FailedRunReference> }

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

function ReprocessOnlyRun({ code, run }: { code: string; run: FailedRunReference }) {
  const t = useTranslations('CodeTranslation.fixed')
  const runTitle = useRunTitle(run)
  const descriptionId = useId()

  return (
    <>
      <p id={descriptionId}>{t('description', { code, document: runTitle })}</p>
      <Link
        href={documentHref(run.id)}
        aria-describedby={descriptionId}
        className="text-foreground w-fit font-medium">
        {t('reprocess')}
      </Link>
    </>
  )
}

function FixedAlert({ fixed }: { fixed: Fixed }) {
  const t = useTranslations('CodeTranslation.fixed')
  const [onlyRun] = fixed.failedRuns

  return (
    <Alert role="status" variant="success">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden />
      <AlertTitle>{t('title', { code: fixed.code, target: fixed.targetCode })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {fixed.failedRuns.length === 1 && onlyRun ? (
          <ReprocessOnlyRun code={fixed.code} run={onlyRun} />
        ) : (
          <>
            <p>{t('reprocessEach', { count: fixed.failedRuns.length })}</p>
            <ul className="flex flex-col gap-1">
              {fixed.failedRuns.map((run) => (
                <li key={run.id}>
                  <FailedRunLink run={run} />
                </li>
              ))}
            </ul>
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}

function RemovedNotice({
  removed,
  saving,
  onUndo,
}: {
  removed: Removed
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
        {t('removed', { code: removed.entry.sourceCode, target: removed.entry.targetCode })}
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

function EmptyValues({ canChange }: { canChange: boolean }) {
  const t = useTranslations('CodeTranslation.values.empty')

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Table01Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>
          {canChange ? t('description') : t('viewOnlyDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function LookupTableValues({
  table,
  missing,
  canChange,
  requestedCode,
}: {
  table: LookupTable
  missing: UseQueryResult<MissingCode[]>
  canChange: boolean
  requestedCode: string | undefined
}) {
  const t = useTranslations('CodeTranslation.values')
  const valuesId = useId()
  const filterId = useId()
  const requestedExists = requestedCode !== undefined && hasValue(table.entries, requestedCode)
  const nextKey = useRef(1)

  const [adding, setAdding] = useState<AddDraft | null>(() =>
    canChange && requestedCode !== undefined && !requestedExists
      ? { key: 0, sourceCode: requestedCode }
      : null,
  )

  const [highlight, setHighlight] = useState(requestedExists ? requestedCode : null)
  const [focusRequest, setFocusRequest] = useState<{ code: string; id: number } | null>(null)
  const [removed, setRemoved] = useState<Removed | null>(null)
  const [fixed, setFixed] = useState<ReadonlyArray<Fixed>>([])
  const [filter, setFilter] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const save = useSaveEntries(table)
  const missingCodes = missing.data ?? []
  const meanings = meaningsOf(table, missingCodes)
  const meaningOf = (code: string) => meanings.get(code) ?? null
  const term = filter.trim().toLocaleLowerCase()

  const visible = table.entries.flatMap((entry, index) =>
    matchesFilter(entry, term) ? [{ entry, index }] : [],
  )

  function suggestionsOf(code: string) {
    return missingCodes.find((missingCode) => missingCode.code === code)?.suggestions ?? []
  }

  function startAdding(sourceCode: string) {
    save.reset()
    setFocusRequest(null)
    setAdding({ key: nextKey.current++, sourceCode })
  }

  function saved(sourceCode: string, focus: boolean) {
    setHighlight(sourceCode)
    setFocusRequest(focus ? { code: sourceCode, id: nextKey.current++ } : null)
    setAnnouncement(t('saved', { code: sourceCode }))
  }

  function add(entry: LookupTableEntry) {
    const blocking = missingCodes.find(
      (missingCode): missingCode is BlockingMissingCode =>
        missingCode.code === entry.sourceCode && missingCode.urgency === 'blocking',
    )

    save.mutate(withEntry(table.entries, entry, null), {
      onSuccess: () => {
        setAdding(null)
        setRemoved(null)
        saved(entry.sourceCode, false)

        if (blocking) {
          setFixed((current) => [
            ...current.filter(({ code }) => code !== entry.sourceCode),
            {
              code: entry.sourceCode,
              targetCode: entry.targetCode,
              failedRuns: blocking.failedRuns,
            },
          ])
        }
      },
    })
  }

  function edit(index: number, entry: LookupTableEntry, done: () => void) {
    save.mutate(withEntry(table.entries, entry, index), {
      onSuccess: () => {
        done()
        setRemoved(null)
        saved(entry.sourceCode, true)
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

    save.mutate(restoredEntry(table.entries, removed.entry, removed.index), {
      onSuccess: () => {
        setRemoved(null)
        saved(removed.entry.sourceCode, true)
        setAnnouncement(t('restored', { code: removed.entry.sourceCode }))
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {fixed.map((item) => (
        <FixedAlert key={item.code} fixed={item} />
      ))}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <MissingCodes
            codes={missing.data}
            isError={missing.isError}
            isPending={missing.isPending}
            onAdd={canChange ? startAdding : null}
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
                  {t('yours')}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    strokeWidth={2}
                    aria-label={t('sentAs')}
                    className="size-4"
                  />
                  {t('theirs')}
                </p>
              </div>
              {canChange && adding === null && (
                <Button variant="outline" onClick={() => startAdding('')}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
                  {t('add')}
                </Button>
              )}
            </div>
            {adding && (
              <AddValueForm
                key={adding.key}
                entries={table.entries}
                initial={adding}
                meaningOf={meaningOf}
                saving={save.isPending}
                suggestionsOf={suggestionsOf}
                onAdd={add}
                onCancel={() => {
                  save.reset()
                  setAdding(null)
                }}
              />
            )}
            {save.isError && <ActionError message={t('errors.saveFailed')} />}
            {removed && (
              <RemovedNotice
                key={`${removed.entry.sourceCode}-${removed.index}`}
                removed={removed}
                saving={save.isPending}
                onUndo={undo}
              />
            )}
            {table.entries.length === 0 ? (
              <EmptyValues canChange={canChange} />
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
        <aside>
          <Card size="sm">
            <CardContent>
              <UsesList showAll uses={table.uses} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
