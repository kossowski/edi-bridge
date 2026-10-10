'use client'

import {
  Add01Icon,
  Building03Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Table01Icon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type RefObject, useMemo, useRef, useState } from 'react'

import { ListScreen, ListTable } from '@/components/list-screen'
import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { LookupTableFormDialog } from '@/components/lookup-tables/lookup-table-form-dialog'
import { lookupTablesQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import { FacetedFilter } from '@edi-bridge/ui/components/faceted-filter'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { LookupTable, LookupTableScope, LookupTableSummary } from '@edi-bridge/contracts'

const columns = ['name', 'scope', 'entries', 'updatedAt', 'actions'] as const

const workspaceScope = 'workspace'

function scopeValue(scope: LookupTableScope) {
  return scope.kind === 'workspace' ? workspaceScope : scope.tradingPartner.id
}

function ScopeLabel({ scope }: { scope: LookupTableScope }) {
  const t = useTranslations('LookupTables.scope')

  return (
    <span className="flex items-center gap-1.5">
      <HugeiconsIcon
        icon={scope.kind === 'workspace' ? Building03Icon : UserMultiple02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      {scope.kind === 'workspace' ? t('workspace') : scope.tradingPartner.name}
    </span>
  )
}

type RowAction = (table: LookupTableSummary, trigger: HTMLElement | null) => void

function LookupTableActions({
  table,
  onEdit,
  onDelete,
}: {
  table: LookupTableSummary
  onEdit: RowAction
  onDelete: RowAction
}) {
  const t = useTranslations('LookupTables.actions')
  const trigger = useRef<HTMLButtonElement>(null)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        render={
          <Button size="icon-sm" variant="ghost" aria-label={t('label', { name: table.name })} />
        }>
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onEdit(table, trigger.current)}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
          {t('edit')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(table, trigger.current)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LookupTableRow({
  table,
  onEdit,
  onDelete,
}: {
  table: LookupTableSummary
  onEdit: RowAction
  onDelete: RowAction
}) {
  const t = useTranslations('LookupTables')
  const format = useFormatter()

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/lookup-tables/${table.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {table.name}
        </Link>
      </TableCell>
      <TableCell>
        <ScopeLabel scope={table.scope} />
      </TableCell>
      <TableCell className="tabular-nums">{t('entryCount', { count: table.entryCount })}</TableCell>
      <TableCell className="tabular-nums">
        {format.dateTime(new Date(table.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </TableCell>
      <TableCell className="relative z-10 w-px text-right">
        <LookupTableActions table={table} onDelete={onDelete} onEdit={onEdit} />
      </TableCell>
    </TableRow>
  )
}

function useScopeFilter(tables: ReadonlyArray<LookupTableSummary> | undefined) {
  const t = useTranslations('LookupTables')
  const [selected, setSelected] = useState<string[]>([])

  const options = useMemo(() => {
    const tradingPartners = new Map<string, string>()

    for (const { scope } of tables ?? []) {
      if (scope.kind === 'tradingPartner') {
        tradingPartners.set(scope.tradingPartner.id, scope.tradingPartner.name)
      }
    }

    return [
      { value: workspaceScope, label: t('scope.workspace'), icon: Building03Icon },
      ...[...tradingPartners]
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([value, label]) => ({ value, label, icon: UserMultiple02Icon })),
    ]
  }, [tables, t])

  const active = selected.filter((value) => options.some((option) => option.value === value))

  return {
    filter:
      active.length === 0
        ? undefined
        : (table: LookupTableSummary) => active.includes(scopeValue(table.scope)),
    element: (
      <FacetedFilter
        clearLabel={t('filters.clear')}
        label={t('columns.scope')}
        options={options}
        selected={active}
        onSelectedChange={setSelected}
      />
    ),
  }
}

type Dialogs = {
  form: { open: boolean; table: LookupTableSummary | null }
  delete: { open: boolean; table: LookupTableSummary | null }
}

function useLookupTableDialogs(newButton: RefObject<HTMLButtonElement | null>) {
  const returnFocus = useRef<HTMLElement | null>(null)

  const [dialogs, setDialogs] = useState<Dialogs>({
    form: { open: false, table: null },
    delete: { open: false, table: null },
  })

  function open(
    kind: keyof Dialogs,
    table: LookupTableSummary | null,
    trigger: HTMLElement | null,
  ) {
    returnFocus.current = trigger ?? newButton.current
    setDialogs((current) => ({ ...current, [kind]: { open: true, table } }))
  }

  function close(kind: keyof Dialogs) {
    setDialogs((current) => ({ ...current, [kind]: { ...current[kind], open: false } }))
  }

  return {
    dialogs,
    returnFocus,
    create: () => open('form', null, null),
    edit: ((table, trigger) => open('form', table, trigger)) satisfies RowAction,
    remove: ((table, trigger) => open('delete', table, trigger)) satisfies RowAction,
    close,
    afterDelete: () => {
      returnFocus.current = newButton.current
      close('delete')
    },
  }
}

export function LookupTablesScreen() {
  const t = useTranslations('LookupTables')
  const tNavigation = useTranslations('Navigation')
  const lookupTables = useQuery(lookupTablesQuery)
  const newButton = useRef<HTMLButtonElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const dialogs = useLookupTableDialogs(newButton)
  const scopeFilter = useScopeFilter(lookupTables.data)

  function saved(table: LookupTable) {
    setAnnouncement(
      dialogs.dialogs.form.table
        ? t('announcements.saved', { name: table.name })
        : t('announcements.created', { name: table.name }),
    )
    dialogs.close('form')
  }

  function deleted(table: LookupTableSummary) {
    setAnnouncement(t('announcements.deleted', { name: table.name }))
    dialogs.afterDelete()
  }

  const newIcon = <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />

  return (
    <ListScreen
      action={
        <Button ref={newButton} onClick={dialogs.create}>
          {newIcon}
          {t('new')}
        </Button>
      }
      title={tNavigation('lookupTables')}>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ListTable
        columns={columns.map((key) => ({
          key,
          label: t(`columns.${key}`),
          hidden: key === 'actions',
        }))}
        emptyAction={
          <Button onClick={dialogs.create}>
            {newIcon}
            {t('new')}
          </Button>
        }
        emptyIcon={Table01Icon}
        filter={scopeFilter.filter}
        matches={(table, term) =>
          table.name.toLocaleLowerCase().includes(term) ||
          (table.scope.kind === 'tradingPartner' &&
            table.scope.tradingPartner.name.toLocaleLowerCase().includes(term))
        }
        pending={false}
        query={lookupTables}
        row={(table) => (
          <LookupTableRow
            key={table.id}
            table={table}
            onDelete={dialogs.remove}
            onEdit={dialogs.edit}
          />
        )}
        t={t}
        toolbar={scopeFilter.element}
      />
      <LookupTableFormDialog
        finalFocus={dialogs.returnFocus}
        open={dialogs.dialogs.form.open}
        table={dialogs.dialogs.form.table}
        onOpenChange={(open) => !open && dialogs.close('form')}
        onSaved={saved}
      />
      <DeleteLookupTableDialog
        finalFocus={dialogs.returnFocus}
        open={dialogs.dialogs.delete.open}
        table={dialogs.dialogs.delete.table}
        onDeleted={deleted}
        onOpenChange={(open) => !open && dialogs.close('delete')}
      />
    </ListScreen>
  )
}
