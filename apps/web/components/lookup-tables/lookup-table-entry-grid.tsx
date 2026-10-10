'use client'

import { Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

import { type CellPosition, gridCommand, moveCell } from '@/components/lookup-tables/grid-keyboard'
import {
  type EntryError,
  type EntryField,
  type EntryRow,
  type RowErrors,
} from '@/components/lookup-tables/lookup-table-entries'
import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

const rowHeight = 56

const headerHeight = 40

const overscan = 6

const fallbackViewport = 560

const columnFields: ReadonlyArray<EntryField | null> = [null, 'sourceCode', 'targetCode', null]

const columnKeys = ['row', 'sourceCode', 'targetCode', 'actions'] as const

const gridColumns = 'grid grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem]'

const cellClass =
  'focus-visible:ring-ring flex min-w-0 flex-col justify-center gap-0.5 px-2 outline-none focus-visible:ring-2 focus-visible:ring-inset'

export type ShownRow = { row: EntryRow; index: number }

export type ActiveCell = { key: number; column: number }

export type Editing = { key: number; field: EntryField; original: string }

export type GridHandlers = {
  onActivate: (cell: ActiveCell, focus: boolean) => void
  onStartEditing: (key: number, field: EntryField, text: string | null) => void
  onChange: (key: number, field: EntryField, value: string) => void
  onCommit: (focus: boolean) => void
  onCancel: () => void
  onAdd: (afterKey: number) => void
  onDelete: (key: number) => void
}

function useErrorMessage() {
  const t = useTranslations('LookupTable.entries.errors')

  return (error: EntryError) => {
    switch (error.kind) {
      case 'required':
        return t('required')
      case 'tooLong':
        return t('tooLong', { max: error.max })
      case 'duplicate':
        return t('duplicate', { row: error.row })
    }
  }
}

function useViewport(scroller: RefObject<HTMLDivElement | null>) {
  const [viewport, setViewport] = useState({ top: 0, height: fallbackViewport })

  useEffect(() => {
    const element = scroller.current

    if (!element) {
      return
    }

    const observer = new ResizeObserver(() =>
      setViewport((current) => ({ ...current, height: element.clientHeight || fallbackViewport })),
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [scroller])

  return {
    viewport,
    onScroll: (top: number) => setViewport((current) => ({ ...current, top })),
  }
}

function renderedIndexes(count: number, top: number, height: number, active: number) {
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan)
  const last = Math.min(count - 1, Math.ceil((top + height) / rowHeight) + overscan)

  const indexes = Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, offset) => first + offset,
  )

  return active >= 0 && (active < first || active > last) ? [...indexes, active] : indexes
}

export function revealCell(
  grid: HTMLElement | null,
  position: number,
  cell: ActiveCell,
  focus: boolean,
) {
  const scroller = grid?.querySelector<HTMLElement>('[data-scroller]')

  if (scroller) {
    const top = position * rowHeight

    if (top < scroller.scrollTop) {
      scroller.scrollTop = top
    } else if (headerHeight + top + rowHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = headerHeight + top + rowHeight - scroller.clientHeight
    }
  }

  if (focus) {
    grid
      ?.querySelector<HTMLElement>(`[data-key="${cell.key}"][data-column="${cell.column}"]`)
      ?.focus({ preventScroll: true })
  }
}

function cellAt(target: EventTarget): ActiveCell | null {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[data-column]') : null

  return cell?.dataset.key !== undefined && cell.dataset.column !== undefined
    ? { key: Number(cell.dataset.key), column: Number(cell.dataset.column) }
    : null
}

function EditInput({
  value,
  label,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  value: string
  label: string
  invalid: boolean
  describedBy: string | undefined
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <Input
      autoComplete="off"
      ref={(input) => {
        if (input && document.activeElement !== input) {
          input.focus({ preventScroll: true })
          input.setSelectionRange(input.value.length, input.value.length)
        }
      }}
      spellCheck={false}
      value={value}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label={label}
      className="h-7 font-mono"
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function CodeCell({
  row,
  number,
  column,
  field,
  tabIndex,
  editing,
  error,
  errorId,
  handlers,
}: {
  row: EntryRow
  number: number
  column: number
  field: EntryField
  tabIndex: number
  editing: boolean
  error: string | null
  errorId: string
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const label = t('cellLabel', { column: t(`columns.${field}`), row: number })

  return (
    <div
      role="gridcell"
      tabIndex={tabIndex}
      aria-invalid={error ? true : undefined}
      className={cn(cellClass, 'cursor-text')}
      data-column={column}
      data-key={row.key}>
      {editing ? (
        <EditInput
          describedBy={error ? errorId : undefined}
          invalid={error !== null}
          label={label}
          value={row[field]}
          onBlur={() => handlers.onCommit(false)}
          onChange={(value) => handlers.onChange(row.key, field, value)}
        />
      ) : (
        <span className="truncate font-mono text-sm">{row[field]}</span>
      )}
      {error && (
        <span id={errorId} className="truncate text-xs text-red-800 dark:text-red-300">
          {error}
        </span>
      )}
    </div>
  )
}

function GridRow({
  shown,
  position,
  activeColumn,
  editingField,
  errors,
  idPrefix,
  handlers,
}: {
  shown: ShownRow
  position: number
  activeColumn: number | null
  editingField: EntryField | null
  errors: RowErrors | undefined
  idPrefix: string
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const errorMessage = useErrorMessage()
  const { row, index } = shown
  const number = index + 1
  const tabIndexOf = (column: number) => (activeColumn === column ? 0 : -1)

  return (
    <div
      role="row"
      aria-rowindex={position + 2}
      className={cn(
        gridColumns,
        'absolute inset-x-0 border-b',
        errors && 'bg-red-50/60 dark:bg-red-950/30',
      )}
      style={{ top: position * rowHeight, height: rowHeight }}>
      <div
        role="rowheader"
        tabIndex={tabIndexOf(0)}
        className={cn(cellClass, 'text-muted-foreground text-sm tabular-nums')}
        data-column={0}
        data-key={row.key}>
        {number}
      </div>
      {(['sourceCode', 'targetCode'] as const).map((field, offset) => {
        const error = errors?.[field]

        return (
          <CodeCell
            key={field}
            column={offset + 1}
            editing={editingField === field}
            error={error ? errorMessage(error) : null}
            errorId={`${idPrefix}-${row.key}-${field}-error`}
            field={field}
            handlers={handlers}
            number={number}
            row={row}
            tabIndex={tabIndexOf(offset + 1)}
          />
        )
      })}
      <div role="gridcell" className="flex items-center justify-center">
        <Button
          size="icon-sm"
          tabIndex={tabIndexOf(3)}
          variant="ghost"
          aria-label={t('deleteRow', { row: number })}
          data-column={3}
          data-key={row.key}
          onClick={() => handlers.onDelete(row.key)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
        </Button>
      </div>
    </div>
  )
}

export function LookupTableEntryGrid({
  shown,
  active,
  editing,
  errors,
  ref,
  labelledBy,
  describedBy,
  handlers,
}: {
  shown: ReadonlyArray<ShownRow>
  active: ActiveCell | null
  editing: Editing | null
  errors: ReadonlyMap<number, RowErrors>
  ref: Ref<HTMLDivElement>
  labelledBy: string
  describedBy: string
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const scroller = useRef<HTMLDivElement>(null)
  const { viewport, onScroll } = useViewport(scroller)
  const foundIndex = active ? shown.findIndex(({ row }) => row.key === active.key) : -1
  const activePosition = foundIndex >= 0 ? foundIndex : 0
  const activeColumn = foundIndex >= 0 && active ? active.column : 1
  const activeKey = shown[activePosition]?.row.key

  const size = {
    rows: shown.length,
    columns: columnKeys.length,
    firstTabColumn: 1,
    pageRows: Math.max(1, Math.floor(viewport.height / rowHeight) - 1),
  }

  function goTo(position: CellPosition) {
    const target = shown[position.row]

    if (target) {
      handlers.onActivate({ key: target.row.key, column: position.column }, true)
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const command = gridCommand(event, editing !== null)

    if (!command || activeKey === undefined) {
      return
    }

    const field = columnFields[activeColumn] ?? null

    switch (command.kind) {
      case 'move': {
        const next = moveCell({ row: activePosition, column: activeColumn }, command.move, size)

        if (editing) {
          handlers.onCommit(false)
        }

        if (next) {
          event.preventDefault()
          goTo(next)
        }

        return
      }

      case 'edit':
      case 'type':
        if (field) {
          event.preventDefault()
          handlers.onStartEditing(activeKey, field, command.kind === 'type' ? command.text : null)
        }

        return
      case 'commit':
        event.preventDefault()
        handlers.onCommit(true)

        return
      case 'cancel':
        event.preventDefault()
        handlers.onCancel()

        return
      case 'add':
        event.preventDefault()
        handlers.onAdd(activeKey)

        return
      case 'delete':
        event.preventDefault()
        handlers.onDelete(activeKey)

        return
      case 'save':
        return
    }
  }

  function click(event: MouseEvent<HTMLDivElement>) {
    const cell = cellAt(event.target)
    const field = cell ? columnFields[cell.column] : null

    if (cell && field && !(editing?.key === cell.key && editing.field === field)) {
      handlers.onStartEditing(cell.key, field, null)
    }
  }

  function focus(event: FocusEvent<HTMLDivElement>) {
    const cell = cellAt(event.target)

    if (cell && (cell.key !== active?.key || cell.column !== active.column)) {
      handlers.onActivate(cell, false)
    }
  }

  const indexes = renderedIndexes(
    shown.length,
    viewport.top,
    viewport.height,
    foundIndex >= 0 ? foundIndex : 0,
  )

  return (
    <div
      ref={ref}
      role="grid"
      tabIndex={-1}
      aria-colcount={columnKeys.length}
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      aria-rowcount={shown.length + 1}
      className="bg-card overflow-hidden rounded-lg border outline-none"
      onClick={click}
      onFocus={focus}
      onKeyDown={keyDown}>
      <div
        ref={scroller}
        className="max-h-[min(35rem,calc(100dvh-18rem))] overflow-y-auto"
        data-scroller
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}>
        <div role="rowgroup" className="bg-muted sticky top-0 z-10 border-b">
          <div
            role="row"
            aria-rowindex={1}
            className={cn(gridColumns, 'items-center')}
            style={{ height: headerHeight }}>
            {columnKeys.map((key) => (
              <div
                key={key}
                role="columnheader"
                className={cn(
                  'text-foreground px-2 text-sm font-medium',
                  key === 'actions' && 'sr-only',
                )}>
                {t(`columns.${key}`)}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="relative" style={{ height: shown.length * rowHeight }}>
          {indexes.map((position) => {
            const item = shown[position]!
            const isActive = item.row.key === activeKey

            return (
              <GridRow
                key={item.row.key}
                activeColumn={isActive ? activeColumn : null}
                editingField={editing?.key === item.row.key ? editing.field : null}
                errors={errors.get(item.index)}
                handlers={handlers}
                idPrefix={labelledBy}
                position={position}
                shown={item}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
