'use client'

import { Add01Icon, Table01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type Ref, type RefObject, useId, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import {
  type CardAction,
  type CardActions,
  hasBlockingCodes,
  LookupTableCard,
} from '@/components/code-translations/lookup-table-card'
import { LoadError } from '@/components/load-error'
import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { LookupTableFormDialog } from '@/components/lookup-tables/lookup-table-form-dialog'
import {
  scopeIcons,
  scopeKey,
  workspaceScopeKey,
} from '@/components/lookup-tables/lookup-table-scope'
import { useCanChange } from '@/hooks/use-session'
import { lookupTablesQuery } from '@/lib/api/queries'
import { newLookupTableHref } from '@/lib/navigation'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { LookupTable, LookupTableScope, LookupTableSummary } from '@edi-bridge/contracts'

const shownPerGroup = 12

type ScopeGroup = {
  key: string
  scope: LookupTableScope
  tables: ReadonlyArray<LookupTableSummary>
}

function blockingFirst(a: LookupTableSummary, b: LookupTableSummary) {
  return Number(hasBlockingCodes(b)) - Number(hasBlockingCodes(a))
}

function partnerName({ scope }: ScopeGroup) {
  return scope.kind === 'tradingPartner' ? scope.tradingPartner.name : ''
}

function byScope(tables: ReadonlyArray<LookupTableSummary>): ScopeGroup[] {
  const groups = new Map<string, { scope: LookupTableScope; tables: LookupTableSummary[] }>()

  for (const table of tables) {
    const key = scopeKey(table.scope)
    const group = groups.get(key) ?? { scope: table.scope, tables: [] }

    group.tables.push(table)
    groups.set(key, group)
  }

  return [...groups]
    .map(([key, group]) => ({
      key,
      scope: group.scope,
      tables: group.tables.toSorted(blockingFirst),
    }))
    .toSorted(
      (a, b) =>
        Number(a.key !== workspaceScopeKey) - Number(b.key !== workspaceScopeKey) ||
        partnerName(a).localeCompare(partnerName(b)),
    )
}

function Group({ group, actions }: { group: ScopeGroup; actions: CardActions | null }) {
  const t = useTranslations('CodeTranslations')
  const headingId = useId()
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? group.tables : group.tables.slice(0, shownPerGroup)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
        <HugeiconsIcon
          icon={scopeIcons[group.scope.kind]}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-4"
        />
        {group.scope.kind === 'workspace'
          ? t('groups.workspace')
          : t('groups.tradingPartner', { name: group.scope.tradingPartner.name })}
        <span className="text-muted-foreground font-normal tabular-nums">
          ({group.tables.length})
        </span>
      </h2>
      <ul id={listId} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((table) => (
          <li key={table.id}>
            <LookupTableCard actions={actions} table={table} />
          </li>
        ))}
      </ul>
      {shown.length < group.tables.length && (
        <Button
          variant="outline"
          aria-controls={listId}
          className="self-start"
          onClick={() => setExpanded(true)}>
          {t('showAll', { count: group.tables.length })}
        </Button>
      )}
    </section>
  )
}

function NewListLink({ ref }: { ref?: Ref<HTMLAnchorElement> }) {
  const t = useTranslations('CodeTranslations')

  return (
    <Link href={newLookupTableHref()} ref={ref} className={buttonVariants()}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
      {t('new')}
    </Link>
  )
}

function NoLists({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations('CodeTranslations.empty')

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Table01Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{t('title')}</h2>
        </EmptyTitle>
        <EmptyDescription>
          {canCreate ? t('description') : t('viewOnlyDescription')}
        </EmptyDescription>
      </EmptyHeader>
      {canCreate && (
        <EmptyContent className="flex-row justify-center">
          <NewListLink />
        </EmptyContent>
      )}
    </Empty>
  )
}

function LoadingLists() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

type Dialogs = {
  form: { open: boolean; table: LookupTableSummary | null }
  delete: { open: boolean; table: LookupTableSummary | null }
}

function useListDialogs(newLink: RefObject<HTMLAnchorElement | null>) {
  const returnFocus = useRef<HTMLElement | null>(null)

  const [state, setState] = useState<Dialogs>({
    form: { open: false, table: null },
    delete: { open: false, table: null },
  })

  function open(kind: keyof Dialogs, table: LookupTableSummary, trigger: HTMLElement | null) {
    returnFocus.current = trigger ?? newLink.current
    setState((current) => ({ ...current, [kind]: { open: true, table } }))
  }

  function close(kind: keyof Dialogs) {
    setState((current) => ({ ...current, [kind]: { ...current[kind], open: false } }))
  }

  return {
    state,
    returnFocus,
    edit: ((table, trigger) => open('form', table, trigger)) satisfies CardAction,
    remove: ((table, trigger) => open('delete', table, trigger)) satisfies CardAction,
    close,
    afterDelete: () => {
      returnFocus.current = newLink.current
      close('delete')
    },
  }
}

export function CodeTranslationsScreen() {
  const t = useTranslations('CodeTranslations')
  const tSidebar = useTranslations('Sidebar.items')
  const { data, isError, isPending, refetch } = useQuery(lookupTablesQuery)
  const canChange = useCanChange()
  const newLink = useRef<HTMLAnchorElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const dialogs = useListDialogs(newLink)
  const actions = canChange ? { onEdit: dialogs.edit, onDelete: dialogs.remove } : null

  function saved(table: LookupTable) {
    setAnnouncement(t('announcements.saved', { name: table.name }))
    dialogs.close('form')
  }

  function deleted(table: LookupTableSummary) {
    setAnnouncement(t('announcements.deleted', { name: table.name }))
    dialogs.afterDelete()
  }

  function content() {
    if (isError) {
      return (
        <LoadError
          description={t('error.description')}
          retryLabel={t('error.retry')}
          title={t('error.title')}
          onRetry={() => void refetch()}
        />
      )
    }

    if (isPending) {
      return <LoadingLists />
    }

    if (data.length === 0) {
      return <NoLists canCreate={canChange} />
    }

    return byScope(data).map((group) => <Group key={group.key} actions={actions} group={group} />)
  }

  const blockingLists = data?.filter(hasBlockingCodes)

  return (
    <AppPage
      busy={isPending && !isError}
      changeActions={<NewListLink ref={newLink} />}
      meta={
        data &&
        data.length > 0 && (
          <p>
            <span className="text-foreground font-medium">
              {t('summary', { count: data.length })}
            </span>
            {blockingLists && blockingLists.length > 0 && (
              <span className="text-destructive-text font-medium">
                {' '}
                &middot; {t('blockingSummary', { count: blockingLists.length })}
              </span>
            )}
          </p>
        )
      }
      title={tSidebar('codeTranslations.label')}>
      <p className="text-muted-foreground max-w-prose text-sm">{t('intro')}</p>
      <p aria-live="polite" className="sr-only">
        {isPending && !isError ? t('loading') : announcement}
      </p>
      <div className="flex flex-col gap-8">{content()}</div>
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
