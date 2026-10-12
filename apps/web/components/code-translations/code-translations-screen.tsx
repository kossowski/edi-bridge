'use client'

import {
  Add01Icon,
  Building03Icon,
  Table01Icon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type Ref, type RefObject, useId, useRef, useState } from 'react'

import { AppPage } from '@/components/app-page'
import {
  type CardAction,
  type CardActions,
  CodeTranslationCard,
} from '@/components/code-translations/code-translation-card'
import { LoadError } from '@/components/load-error'
import { DeleteLookupTableDialog } from '@/components/lookup-tables/delete-lookup-table-dialog'
import { LookupTableFormDialog } from '@/components/lookup-tables/lookup-table-form-dialog'
import { useCanChange } from '@/hooks/use-session'
import { lookupTablesQuery } from '@/lib/api/queries'
import { codeTranslationHref } from '@/lib/navigation'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { LookupTable, LookupTableSummary } from '@edi-bridge/contracts'

const shownPerGroup = 12

type ReceiverGroup = {
  key: string
  tradingPartnerName: string | null
  tables: ReadonlyArray<LookupTableSummary>
}

function blockingFirst(a: LookupTableSummary, b: LookupTableSummary) {
  return Number(b.missingCodeCounts.blocking > 0) - Number(a.missingCodeCounts.blocking > 0)
}

function byReceiver(tables: ReadonlyArray<LookupTableSummary>): ReceiverGroup[] {
  const workspace: LookupTableSummary[] = []
  const partners = new Map<string, { name: string; tables: LookupTableSummary[] }>()

  for (const table of tables) {
    if (table.scope.kind === 'workspace') {
      workspace.push(table)
    } else {
      const { id, name } = table.scope.tradingPartner
      const group = partners.get(id) ?? { name, tables: [] }

      group.tables.push(table)
      partners.set(id, group)
    }
  }

  const partnerGroups = [...partners]
    .toSorted(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([key, { name, tables: partnerTables }]) => ({
      key,
      tradingPartnerName: name,
      tables: partnerTables.toSorted(blockingFirst),
    }))

  return [
    ...(workspace.length > 0
      ? [{ key: 'workspace', tradingPartnerName: null, tables: workspace.toSorted(blockingFirst) }]
      : []),
    ...partnerGroups,
  ]
}

function Group({ group, actions }: { group: ReceiverGroup; actions: CardActions | null }) {
  const t = useTranslations('CodeTranslations')
  const headingId = useId()
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? group.tables : group.tables.slice(0, shownPerGroup)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
        <HugeiconsIcon
          icon={group.tradingPartnerName === null ? Building03Icon : UserMultiple02Icon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground size-4"
        />
        {group.tradingPartnerName === null
          ? t('groups.workspace')
          : t('groups.tradingPartner', { name: group.tradingPartnerName })}
        <span className="text-muted-foreground font-normal tabular-nums">
          ({group.tables.length})
        </span>
      </h2>
      <ul id={listId} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((table) => (
          <li key={table.id}>
            <CodeTranslationCard actions={actions} table={table} />
          </li>
        ))}
      </ul>
      {shown.length < group.tables.length && (
        <Button
          variant="outline"
          aria-controls={listId}
          aria-expanded={false}
          className="self-start"
          onClick={() => setExpanded(true)}>
          {t('showAll', { count: group.tables.length })}
        </Button>
      )}
    </section>
  )
}

function NewListButton({ ref, onClick }: { ref?: Ref<HTMLButtonElement>; onClick: () => void }) {
  const t = useTranslations('CodeTranslations')

  return (
    <Button ref={ref} onClick={onClick}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
      {t('new')}
    </Button>
  )
}

function NoLists({ onCreate }: { onCreate: (() => void) | null }) {
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
          {onCreate ? t('description') : t('viewOnlyDescription')}
        </EmptyDescription>
      </EmptyHeader>
      {onCreate && (
        <EmptyContent className="flex-row justify-center">
          <NewListButton onClick={onCreate} />
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

function useListDialogs(newButton: RefObject<HTMLButtonElement | null>) {
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
    edit: ((table, trigger) => open('form', table, trigger)) satisfies CardAction,
    remove: ((table, trigger) => open('delete', table, trigger)) satisfies CardAction,
    close,
    afterDelete: () => {
      returnFocus.current = newButton.current
      close('delete')
    },
  }
}

export function CodeTranslationsScreen() {
  const t = useTranslations('CodeTranslations')
  const tSidebar = useTranslations('Sidebar.items')
  const { data, isError, isPending, refetch } = useQuery(lookupTablesQuery)
  const router = useRouter()
  const canChange = useCanChange()
  const newButton = useRef<HTMLButtonElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const dialogs = useListDialogs(newButton)
  const actions = canChange ? { onEdit: dialogs.edit, onDelete: dialogs.remove } : null

  function saved(table: LookupTable) {
    if (!dialogs.state.form.table) {
      router.push(codeTranslationHref(table.id))

      return
    }

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
      return <NoLists onCreate={canChange ? dialogs.create : null} />
    }

    return byReceiver(data).map((group) => (
      <Group key={group.key} actions={actions} group={group} />
    ))
  }

  const blockingLists = data?.filter(({ missingCodeCounts }) => missingCodeCounts.blocking > 0)

  return (
    <AppPage
      busy={isPending && !isError}
      changeActions={<NewListButton ref={newButton} onClick={dialogs.create} />}
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
