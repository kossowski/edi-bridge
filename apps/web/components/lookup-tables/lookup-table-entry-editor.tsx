'use client'

import { Add01Icon, FileImportIcon, Table01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
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
import { isSaveShortcut } from '@/components/lookup-tables/grid-keyboard'
import { ImportCsvDialog } from '@/components/lookup-tables/import-csv-dialog'
import { type EntryField, matchesFilter } from '@/components/lookup-tables/lookup-table-entries'
import {
  type ActiveCell,
  type Editing,
  type EntryGridHandle,
  type GridHandlers,
  columnOf,
  LookupTableEntryGrid,
  positionOf,
  type VisibleRow,
} from '@/components/lookup-tables/lookup-table-entry-grid'
import { useEntryEditing } from '@/components/lookup-tables/use-entry-editing'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'

import type { ImportCounts } from '@/components/lookup-tables/lookup-table-import'
import type { LookupTable } from '@edi-bridge/contracts'

const shortcuts = ['move', 'tab', 'edit', 'commit', 'cancel', 'add', 'delete', 'save'] as const

function dialogOpen() {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
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

export function LookupTableEntryEditor({ table }: { table: LookupTable }) {
  const t = useTranslations('LookupTable.entries')
  const tImport = useTranslations('LookupTable.import')
  const ids = { title: useId(), hint: useId(), filter: useId() }
  const [active, setActive] = useState<ActiveCell | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filter, setFilter] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const importButton = useRef<HTMLButtonElement>(null)
  const focusRequest = useRef(false)
  const grid = useRef<EntryGridHandle>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAddButton = useRef(false)
  const term = useDeferredValue(filter.trim().toLocaleLowerCase())

  const entries = useEntryEditing(table, {
    onSaved: () => setAnnouncement(t('announcements.saved')),
  })

  const { rows, saving } = entries

  const visibleRows = useMemo<VisibleRow[]>(
    () => rows.flatMap((row, index) => (matchesFilter(row, term) ? [{ row, index }] : [])),
    [rows, term],
  )

  useLayoutEffect(() => {
    if (focusAddButton.current) {
      focusAddButton.current = false
      addButton.current?.focus()
    }

    if (focusRequest.current && active && positionOf(visibleRows, active.key) >= 0) {
      focusRequest.current = false
      grid.current?.reveal(active, editing === null)
    }
  })

  function startEditing(key: number, field: EntryField, text: string | null) {
    const row = rows.find((candidate) => candidate.key === key)

    if (!row || saving) {
      return
    }

    setActive({ key, column: columnOf(field) })
    setEditing({ key, field, original: row[field] })

    if (text !== null) {
      entries.updateRow(key, field, text)
    }
  }

  function activate(cell: ActiveCell, focus: boolean) {
    if (active && active.key !== cell.key) {
      entries.markTouched(active.key)
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
      entries.updateRow(editing.key, editing.field, editing.original)
      setEditing(null)
      focusRequest.current = true
    }
  }

  function add(afterKey?: number) {
    if (saving) {
      return
    }

    const { key, index } = entries.insertRow(afterKey, active?.key)

    setFilter('')
    setActive({ key, column: columnOf('sourceCode') })
    setEditing({ key, field: 'sourceCode', original: '' })
    focusRequest.current = true
    setAnnouncement(t('announcements.added', { row: index + 1 }))
  }

  function remove(key: number) {
    if (saving) {
      return
    }

    const position = positionOf(visibleRows, key)
    const neighbour = visibleRows[position + 1] ?? visibleRows[position - 1]
    const index = entries.removeRow(key)

    setEditing(null)
    setAnnouncement(t('announcements.deleted', { row: index + 1 }))

    if (neighbour) {
      setActive({ key: neighbour.row.key, column: active?.column ?? columnOf('sourceCode') })
      focusRequest.current = true
    } else {
      setActive(null)
      focusAddButton.current = true
    }
  }

  function discard() {
    entries.discard()
    setActive(null)
    setEditing(null)
    setAnnouncement(t('announcements.discarded'))
  }

  function applyImported(saved: LookupTable, counts: ImportCounts) {
    entries.load(saved.entries)
    setActive(null)
    setEditing(null)
    setImportOpen(false)
    setAnnouncement(tImport('applied', { added: counts.added, changed: counts.changed }))
  }

  function submit() {
    setEditing(null)

    const invalid = entries.submit()

    if (!invalid) {
      return
    }

    if (positionOf(visibleRows, invalid.key) < 0) {
      setFilter('')
    }

    setActive({ key: invalid.key, column: columnOf(invalid.field) })
    focusRequest.current = true
  }

  const saveShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (isSaveShortcut(event) && !dialogOpen()) {
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
    onChange: entries.updateRow,
    onCommit: commit,
    onCancel: cancel,
    onAdd: add,
    onDelete: remove,
  }

  const { dirty, errorCount } = entries
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
            {saving ? t('savingReadOnly') : dirty ? t('unsaved') : t('upToDate')}
          </span>
          <Button
            disabled={saving}
            ref={importButton}
            variant="outline"
            onClick={() => {
              setEditing(null)
              setImportOpen(true)
            }}>
            <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} aria-hidden />
            {tImport('open')}
          </Button>
          <Button disabled={!dirty || saving} variant="outline" onClick={discard}>
            {t('discard')}
          </Button>
          <Button disabled={!dirty || saving} aria-keyshortcuts="Control+S Meta+S" onClick={submit}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
      {errorCount > 0 && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('errors.summary', { count: errorCount })}
        </p>
      )}
      {entries.saveFailed && (
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
              ? t('filteredCount', { count: visibleRows.length, total: rows.length })
              : t('count', { count: rows.length })}
          </p>
          <Button
            disabled={saving}
            ref={addButton}
            variant="outline"
            onClick={() => add(active?.key)}>
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
      ) : visibleRows.length === 0 ? (
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
            errors={entries.errors}
            handlers={handlers}
            labelledBy={ids.title}
            readOnly={saving}
            ref={grid}
            visibleRows={visibleRows}
          />
        </>
      )}
      <Shortcuts />
      <ImportCsvDialog
        dirty={dirty}
        finalFocus={importButton}
        open={importOpen}
        table={table}
        onDiscard={discard}
        onImported={applyImported}
        onOpenChange={setImportOpen}
      />
    </section>
  )
}
