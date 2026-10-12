'use client'

import {
  Add01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Table01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type Ref, type RefObject, useMemo, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { ListTable } from '@/components/list-table'
import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { LookupTableFormDialog } from '@/components/lookup-tables/lookup-table-form-dialog'
import {
  scopeIcons,
  scopeKey,
  workspaceScopeKey,
} from '@/components/lookup-tables/lookup-table-scope'
import { ScopeLabel } from '@/components/lookup-tables/lookup-table-scope-label'
import { useCanChange } from '@/hooks/use-session'
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

import type { LookupTable, LookupTableSummary } from '@edi-bridge/contracts'

const columns = ['name', 'scope', 'entries', 'updatedAt', 'actions'] as const

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
  actions,
}: {
  table: LookupTableSummary
  actions: { onEdit: RowAction; onDelete: RowAction } | null
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
      {actions && (
        <TableCell className="relative w-px text-right">
          <LookupTableActions table={table} onDelete={actions.onDelete} onEdit={actions.onEdit} />
        </TableCell>
      )}
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
      { value: workspaceScopeKey, label: t('scope.workspace'), icon: scopeIcons.workspace },
      ...[...tradingPartners]
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([value, label]) => ({ value, label, icon: scopeIcons.tradingPartner })),
    ]
  }, [tables, t])

  const active = selected.filter((value) => options.some((option) => option.value === value))

  return {
    filter:
      active.length === 0
        ? undefined
        : (table: LookupTableSummary) => active.includes(scopeKey(table.scope)),
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

function NewLookupTableButton({
  ref,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>
  onClick: () => void
}) {
  const t = useTranslations('LookupTables')

  return (
    <Button ref={ref} onClick={onClick}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
      {t('new')}
    </Button>
  )
}

type Dialogs = {
  form: { open: boolean; table: LookupTableSummary | null }
  delete: { open: boolean; table: LookupTableSummary | null }
}

function useLookupTableDialogs(newButton: RefObject<HTMLButtonElement | null>) {
  const returnFocus = useRef<HTMLElement | null>(null)

  const [state, setState] = useState<Dialogs>({
    form: { open: false, table: null },
    delete: { open: false, table: null },
  })

  function open(
    kind: keyof Dialogs,
    table: LookupTableSummary | null,
    trigger: HTMLElement | null,
  ) {
    returnFocus.current = trigger ?? newButton.current
    setState((current) => ({ ...current, [kind]: { open: true, table } }))
  }

  function close(kind: keyof Dialogs) {
    setState((current) => ({ ...current, [kind]: { ...current[kind], open: false } }))
  }

  return {
    state,
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
  const tSidebar = useTranslations('Sidebar.items')
  const lookupTables = useQuery(lookupTablesQuery)
  const router = useRouter()
  const newButton = useRef<HTMLButtonElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const dialogs = useLookupTableDialogs(newButton)
  const scopeFilter = useScopeFilter(lookupTables.data)
  const canChange = useCanChange()

  function saved(table: LookupTable) {
    if (!dialogs.state.form.table) {
      router.push(`/lookup-tables/${table.id}`)

      return
    }

    setAnnouncement(t('announcements.saved', { name: table.name }))
    dialogs.close('form')
  }

  function deleted(table: LookupTableSummary) {
    setAnnouncement(t('announcements.deleted', { name: table.name }))
    dialogs.afterDelete()
  }

  return (
    <AppPage
      changeActions={<NewLookupTableButton ref={newButton} onClick={dialogs.create} />}
      title={tSidebar('codeTranslations.label')}
      className="gap-4">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <ListTable
        columns={columns.flatMap((key) =>
          canChange || key !== 'actions'
            ? [{ key, label: t(`columns.${key}`), hidden: key === 'actions' }]
            : [],
        )}
        emptyAction={<NewLookupTableButton onClick={dialogs.create} />}
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
            actions={canChange ? { onEdit: dialogs.edit, onDelete: dialogs.remove } : null}
            table={table}
          />
        )}
        t={t}
        toolbar={scopeFilter.element}
      />
      <LookupTableFormDialog
        finalFocus={dialogs.returnFocus}
        open={dialogs.state.form.open}
        table={dialogs.state.form.table}
        onOpenChange={(open) => !open && dialogs.close('form')}
        onSaved={saved}
      />
      <DeleteLookupTableDialog
        finalFocus={dialogs.returnFocus}
        open={dialogs.state.delete.open}
        table={dialogs.state.delete.table}
        onDeleted={deleted}
        onOpenChange={(open) => !open && dialogs.close('delete')}
      />
    </AppPage>
  )
}
