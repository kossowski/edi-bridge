'use client'

import { Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import {
  type FocusEvent,
  type KeyboardEvent,
  type ComponentProps,
  type MouseEvent,
  type Ref,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

import {
  type CellPosition,
  gridCommand,
  type GridSize,
  moveCell,
} from '@/components/lookup-tables/grid-keyboard'
import {
  type EntryError,
  type EntryField,
  entryFields,
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

export const gridColumns = ['row', 'sourceCode', 'targetCode', 'actions'] as const

export function columnOf(key: (typeof gridColumns)[number]) {
  return gridColumns.indexOf(key)
}

function fieldAt(column: number): EntryField | null {
  return entryFields.find((field) => columnOf(field) === column) ?? null
}

export type VisibleRow = { row: EntryRow; index: number }

export function positionOf(visibleRows: ReadonlyArray<VisibleRow>, key: number) {
  return visibleRows.findIndex(({ row }) => row.key === key)
}

export type ActiveCell = { key: number; column: number }

export type Editing = { key: number; field: EntryField; original: string }

export type EntryGridHandle = { reveal: (cell: ActiveCell, focus: boolean) => void }

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

function cellAt(target: EventTarget): ActiveCell | null {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[data-column]') : null

  return cell?.dataset.key !== undefined && cell.dataset.column !== undefined
    ? { key: Number(cell.dataset.key), column: Number(cell.dataset.column) }
    : null
}

function GridRow({ viewOnly, className, ...props }: ComponentProps<'div'> & { viewOnly: boolean }) {
  return (
    <div
      role="row"
      className={cn(
        'grid',
        viewOnly
          ? 'grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)]'
          : 'grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_3.5rem]',
        className,
      )}
      {...props}
    />
  )
}

function GridCell({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'focus-visible:ring-foreground flex min-w-0 scroll-mt-10 flex-col justify-center gap-0.5 px-2 outline-none focus-visible:ring-2 focus-visible:ring-inset',
        className,
      )}
      {...props}
    />
  )
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
  rowNumber,
  field,
  tabIndex,
  editing,
  error,
  errorId,
  viewOnly,
  handlers,
}: {
  row: EntryRow
  rowNumber: number
  field: EntryField
  tabIndex: number
  editing: boolean
  error: string | null
  errorId: string
  viewOnly: boolean
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const label = t('cellLabel', { column: t(`columns.${field}`), row: rowNumber })

  return (
    <GridCell
      role="gridcell"
      tabIndex={tabIndex}
      aria-invalid={error ? true : undefined}
      className={viewOnly ? undefined : 'cursor-text'}
      data-column={columnOf(field)}
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
    </GridCell>
  )
}

function EntryGridRow({
  visibleRow,
  position,
  activeColumn,
  editingField,
  errors,
  idPrefix,
  readOnly,
  viewOnly,
  handlers,
}: {
  visibleRow: VisibleRow
  position: number
  activeColumn: number | null
  editingField: EntryField | null
  errors: RowErrors | undefined
  idPrefix: string
  readOnly: boolean
  viewOnly: boolean
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const errorMessage = useErrorMessage()
  const { row, index } = visibleRow
  const rowNumber = index + 1
  const tabIndexOf = (column: number) => (activeColumn === column ? 0 : -1)

  return (
    <GridRow
      viewOnly={viewOnly}
      aria-rowindex={position + 2}
      className={cn('absolute inset-x-0 border-b', errors && 'bg-red-50/60 dark:bg-red-950/30')}
      style={{ top: position * rowHeight, height: rowHeight }}>
      <GridCell
        role="rowheader"
        tabIndex={tabIndexOf(columnOf('row'))}
        className="text-muted-foreground text-sm tabular-nums"
        data-column={columnOf('row')}
        data-key={row.key}>
        {rowNumber}
      </GridCell>
      {entryFields.map((field) => {
        const error = errors?.[field]

        return (
          <CodeCell
            key={field}
            editing={editingField === field}
            error={error ? errorMessage(error) : null}
            errorId={`${idPrefix}-${row.key}-${field}-error`}
            field={field}
            handlers={handlers}
            row={row}
            rowNumber={rowNumber}
            tabIndex={tabIndexOf(columnOf(field))}
            viewOnly={viewOnly}
          />
        )
      })}
      {!viewOnly && (
        <div role="gridcell" className="flex items-center justify-center">
          <Button
            size="icon-sm"
            tabIndex={tabIndexOf(columnOf('actions'))}
            variant="ghost"
            aria-disabled={readOnly || undefined}
            aria-label={t('deleteRow', { row: rowNumber })}
            className="scroll-mt-10"
            data-column={columnOf('actions')}
            data-key={row.key}
            onClick={() => handlers.onDelete(row.key)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      )}
    </GridRow>
  )
}

export function LookupTableEntryGrid({
  visibleRows,
  active,
  editing,
  errors,
  readOnly,
  viewOnly = false,
  ref,
  labelledBy,
  describedBy,
  handlers,
}: {
  visibleRows: ReadonlyArray<VisibleRow>
  active: ActiveCell | null
  editing: Editing | null
  errors: ReadonlyMap<number, RowErrors>
  readOnly: boolean
  viewOnly?: boolean
  ref: Ref<EntryGridHandle>
  labelledBy: string
  describedBy: string
  handlers: GridHandlers
}) {
  const t = useTranslations('LookupTable.entries')
  const errorMessage = useErrorMessage()
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { viewport, onScroll } = useViewport(scroller)
  const activePosition = active ? positionOf(visibleRows, active.key) : -1
  const columns = viewOnly ? gridColumns.filter((column) => column !== 'actions') : gridColumns

  const current: CellPosition =
    active && activePosition >= 0
      ? { row: activePosition, column: active.column }
      : { row: 0, column: columnOf('sourceCode') }

  const currentRow = visibleRows[current.row]
  const currentField = fieldAt(current.column)

  const currentError =
    activePosition >= 0 && currentRow && currentField
      ? errors.get(currentRow.index)?.[currentField]
      : undefined

  const size: GridSize = {
    rows: visibleRows.length,
    columns: columns.length,
    editColumns: { first: columnOf('sourceCode'), last: columnOf('targetCode') },
    pageRows: Math.max(1, Math.floor(viewport.height / rowHeight) - 1),
  }

  useImperativeHandle(
    ref,
    () => ({
      reveal(cell, focus) {
        const element = root.current?.querySelector<HTMLElement>(
          `[data-key="${cell.key}"][data-column="${cell.column}"]`,
        )

        if (focus) {
          element?.focus({ preventScroll: true })
        }

        element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      },
    }),
    [],
  )

  function goTo(position: CellPosition) {
    const target = visibleRows[position.row]

    if (target) {
      handlers.onActivate({ key: target.row.key, column: position.column }, true)
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const command = gridCommand(event, editing !== null)
    const activeKey = currentRow?.row.key

    if (!command || activeKey === undefined || (viewOnly && command.kind !== 'move')) {
      return
    }

    switch (command.kind) {
      case 'move': {
        const next = moveCell(current, command.move, size)

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
        if (currentField && !readOnly) {
          event.preventDefault()
          handlers.onStartEditing(
            activeKey,
            currentField,
            command.kind === 'type' ? command.text : null,
          )
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
    const field = cell ? fieldAt(cell.column) : null

    if (
      cell &&
      field &&
      !readOnly &&
      !viewOnly &&
      !(editing?.key === cell.key && editing.field === field)
    ) {
      handlers.onStartEditing(cell.key, field, null)
    }
  }

  function focus(event: FocusEvent<HTMLDivElement>) {
    const cell = cellAt(event.target)

    if (cell && (cell.key !== active?.key || cell.column !== active.column)) {
      handlers.onActivate(cell, false)
    }
  }

  const indexes = renderedIndexes(visibleRows.length, viewport.top, viewport.height, current.row)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        ref={root}
        role="grid"
        tabIndex={-1}
        aria-busy={readOnly || undefined}
        aria-colcount={columns.length}
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        aria-readonly={readOnly || viewOnly || undefined}
        aria-rowcount={visibleRows.length + 1}
        className={cn(
          'bg-card overflow-hidden rounded-lg border outline-none',
          readOnly && 'bg-muted/40',
        )}
        onClick={click}
        onFocus={focus}
        onKeyDown={keyDown}>
        <div
          ref={scroller}
          className="max-h-[min(35rem,calc(100dvh-18rem))] overflow-y-auto"
          onScroll={(event) => onScroll(event.currentTarget.scrollTop)}>
          <div role="rowgroup" className="bg-muted sticky top-0 z-10 border-b">
            <GridRow
              viewOnly={viewOnly}
              aria-rowindex={1}
              className="items-center"
              style={{ height: headerHeight }}>
              {columns.map((key) => (
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
            </GridRow>
          </div>
          <div
            role="rowgroup"
            className="relative"
            style={{ height: visibleRows.length * rowHeight }}>
            {indexes.map((position) => {
              const item = visibleRows[position]!
              const isActive = position === current.row

              return (
                <EntryGridRow
                  key={item.row.key}
                  activeColumn={isActive ? current.column : null}
                  editingField={editing?.key === item.row.key ? editing.field : null}
                  errors={errors.get(item.index)}
                  handlers={handlers}
                  idPrefix={labelledBy}
                  position={position}
                  readOnly={readOnly}
                  viewOnly={viewOnly}
                  visibleRow={item}
                />
              )
            })}
          </div>
        </div>
      </div>
      {currentError && currentRow && currentField && (
        <p className="text-sm text-red-800 dark:text-red-300">
          {t('activeError', {
            column: t(`columns.${currentField}`),
            row: currentRow.index + 1,
            error: errorMessage(currentError),
          })}
        </p>
      )}
    </div>
  )
}
