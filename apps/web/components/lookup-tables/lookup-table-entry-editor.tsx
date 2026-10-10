'use client'

import { Add01Icon, Table01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { LeaveGuard } from '@/components/leave-guard'
import { gridCommand } from '@/components/lookup-tables/grid-keyboard'
import {
  type EntryField,
  type EntryRow,
  matchesFilter,
  type RowErrors,
  sameEntries,
  toRows,
  validateEntries,
} from '@/components/lookup-tables/lookup-table-entries'
import {
  type ActiveCell,
  type Editing,
  type GridHandlers,
  LookupTableEntryGrid,
  revealCell,
  type ShownRow,
} from '@/components/lookup-tables/lookup-table-entry-grid'
import { toScopeInput } from '@/components/lookup-tables/lookup-table-scope'
import { updateLookupTable } from '@/lib/api/client'
import { lookupTableQuery, storeSavedLookupTable } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'

import type { LookupTable, LookupTableEntry } from '@edi-bridge/contracts'

const shortcuts = ['move', 'tab', 'edit', 'commit', 'cancel', 'add', 'delete', 'save'] as const

const fieldColumns: Record<EntryField, number> = { sourceCode: 1, targetCode: 2 }

function without(keys: ReadonlySet<number>, key: number) {
  const next = new Set(keys)
  next.delete(key)

  return next
}

function withoutRequired(errors: RowErrors): RowErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, error]) => error.kind !== 'required'))
}

function Shortcuts() {
  const t = useTranslations('LookupTable.entries.shortcuts')

  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-3">
        {t('title')}
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {shortcuts.map((shortcut) => (
          <div key={shortcut} className="contents">
            <dt>
              <kbd className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                {t(`items.${shortcut}.keys`)}
              </kbd>
            </dt>
            <dd className="text-muted-foreground mb-1 sm:mb-0">{t(`items.${shortcut}.action`)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function useSaveEntries(table: LookupTable, onSaved: (saved: LookupTable) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (entries: LookupTableEntry[]) => {
      const current = queryClient.getQueryData(lookupTableQuery(table.id).queryKey) ?? table

      return updateLookupTable(table.id, {
        name: current.name,
        scope: toScopeInput(current.scope),
        entries,
      })
    },
    onSuccess: (saved) => {
      storeSavedLookupTable(queryClient, saved)
      onSaved(saved)
    },
  })
}

export function LookupTableEntryEditor({ table }: { table: LookupTable }) {
  const t = useTranslations('LookupTable.entries')
  const ids = { title: useId(), hint: useId(), filter: useId() }
  const [baseline, setBaseline] = useState<ReadonlyArray<LookupTableEntry>>(table.entries)
  const [rows, setRows] = useState<EntryRow[]>(() => toRows(table.entries))
  const nextKey = useRef(table.entries.length)
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set())
  const [active, setActive] = useState<ActiveCell | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filter, setFilter] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const focusRequest = useRef(false)
  const grid = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAddButton = useRef(false)
  const term = useDeferredValue(filter.trim().toLocaleLowerCase())

  const save = useSaveEntries(table, (saved) => {
    setBaseline(saved.entries)
    setRows((current) =>
      current.length === saved.entries.length
        ? current.map((row, index) => ({ ...row, ...saved.entries[index] }))
        : current,
    )
    setAttempted(false)
    setAnnouncement(t('announcements.saved'))
  })

  const validation = useMemo(() => validateEntries(rows), [rows])
  const dirty = useMemo(() => !sameEntries(rows, baseline), [rows, baseline])

  const shown = useMemo<ShownRow[]>(
    () => rows.flatMap((row, index) => (matchesFilter(row, term) ? [{ row, index }] : [])),
    [rows, term],
  )

  const errors = useMemo(() => {
    const visible = new Map<number, RowErrors>()

    if ('errors' in validation) {
      for (const [index, rowErrors] of validation.errors) {
        const shownErrors = fresh.has(rows[index]?.key ?? -1)
          ? withoutRequired(rowErrors)
          : rowErrors

        if (shownErrors.sourceCode || shownErrors.targetCode) {
          visible.set(index, shownErrors)
        }
      }
    }

    return visible
  }, [validation, fresh, rows])

  useLayoutEffect(() => {
    if (focusAddButton.current) {
      focusAddButton.current = false
      addButton.current?.focus()
    }

    const position = active ? shown.findIndex(({ row }) => row.key === active.key) : -1

    if (focusRequest.current && active && position >= 0) {
      focusRequest.current = false
      revealCell(grid.current, position, active, editing === null)
    }
  })

  function updateRow(key: number, field: EntryField, value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  function startEditing(key: number, field: EntryField, text: string | null) {
    const row = rows.find((candidate) => candidate.key === key)

    if (!row) {
      return
    }

    setActive({ key, column: fieldColumns[field] })
    setEditing({ key, field, original: row[field] })

    if (text !== null) {
      updateRow(key, field, text)
    }
  }

  function activate(cell: ActiveCell, focus: boolean) {
    if (active && active.key !== cell.key) {
      setFresh((current) => without(current, active.key))
    }

    setActive(cell)
    focusRequest.current ||= focus
  }

  function commit(focus: boolean) {
    if (editing) {
      setEditing(null)
      focusRequest.current ||= focus
    }
  }

  function cancel() {
    if (editing) {
      updateRow(editing.key, editing.field, editing.original)
      setEditing(null)
      focusRequest.current = true
    }
  }

  function add(afterKey?: number) {
    const key = nextKey.current++
    const afterIndex = rows.findIndex((row) => row.key === afterKey)
    const index = afterKey === undefined || afterIndex < 0 ? rows.length : afterIndex + 1
    const row = { key, sourceCode: '', targetCode: '' }

    setRows((current) => [...current.slice(0, index), row, ...current.slice(index)])
    setFresh((current) => new Set(without(current, active?.key ?? -1)).add(key))
    setFilter('')
    setActive({ key, column: 1 })
    setEditing({ key, field: 'sourceCode', original: '' })
    focusRequest.current = true
    setAnnouncement(t('announcements.added', { row: index + 1 }))
  }

  function remove(key: number) {
    const index = rows.findIndex((row) => row.key === key)
    const position = shown.findIndex(({ row }) => row.key === key)
    const neighbour = shown[position + 1] ?? shown[position - 1]

    setRows((current) => current.filter((row) => row.key !== key))
    setFresh((current) => without(current, key))
    setEditing(null)
    setAnnouncement(t('announcements.deleted', { row: index + 1 }))

    if (neighbour) {
      setActive({ key: neighbour.row.key, column: active?.column ?? 1 })
      focusRequest.current = true
    } else {
      setActive(null)
      focusAddButton.current = true
    }
  }

  function discard() {
    setRows(toRows(baseline, nextKey.current))
    nextKey.current += baseline.length
    setFresh(new Set())
    setActive(null)
    setEditing(null)
    setAttempted(false)
    save.reset()
    setAnnouncement(t('announcements.discarded'))
  }

  function submit() {
    setEditing(null)
    setFresh(new Set())
    setAttempted(true)

    if ('errors' in validation) {
      const index = Math.min(...validation.errors.keys())
      const rowErrors = validation.errors.get(index)!
      const key = rows[index]!.key

      if (!shown.some(({ row }) => row.key === key)) {
        setFilter('')
      }

      setActive({ key, column: rowErrors.sourceCode ? 1 : 2 })
      focusRequest.current = true

      return
    }

    if (dirty && !save.isPending) {
      save.mutate(validation.entries)
    }
  }

  const saveShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (gridCommand(event, true)?.kind === 'save') {
      event.preventDefault()
      submit()
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', saveShortcut)

    return () => document.removeEventListener('keydown', saveShortcut)
  }, [])

  const handlers: GridHandlers = {
    onActivate: activate,
    onStartEditing: startEditing,
    onChange: updateRow,
    onCommit: commit,
    onCancel: cancel,
    onAdd: add,
    onDelete: remove,
  }

  const errorCount = 'errors' in validation ? validation.errors.size : 0
  const filtered = term !== ''

  return (
    <section aria-labelledby={ids.title} className="flex min-w-0 flex-col gap-4">
      <LeaveGuard when={dirty} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 id={ids.title} className="font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {dirty ? t('unsaved') : t('upToDate')}
          </span>
          <Button disabled={!dirty || save.isPending} variant="outline" onClick={discard}>
            {t('discard')}
          </Button>
          <Button
            disabled={!dirty || save.isPending}
            aria-keyshortcuts="Control+S Meta+S"
            onClick={submit}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
      {attempted && errorCount > 0 && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('errors.summary', { count: errorCount })}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('errors.saveFailed')}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <label htmlFor={ids.filter} className="text-sm font-medium">
            {t('filter')}
          </label>
          <Input
            id={ids.filter}
            disabled={rows.length === 0}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {filtered
              ? t('filteredCount', { count: shown.length, total: rows.length })
              : t('count', { count: rows.length })}
          </p>
          <Button ref={addButton} variant="outline" onClick={() => add(active?.key)}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
            {t('add')}
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Table01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border px-2 py-6 text-center text-sm">
          {t('noMatch')}
        </p>
      ) : (
        <>
          <p id={ids.hint} className="text-muted-foreground text-sm">
            {t('hint')}
          </p>
          <LookupTableEntryGrid
            active={active}
            describedBy={ids.hint}
            editing={editing}
            errors={errors}
            handlers={handlers}
            labelledBy={ids.title}
            ref={grid}
            shown={shown}
          />
        </>
      )}
      <Shortcuts />
    </section>
  )
}
