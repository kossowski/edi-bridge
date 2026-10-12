'use client'

import { Add01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'

import type { IconSvgElement } from '@hugeicons/react'

import { LoadError } from '@/components/load-error'
import { useCanChange } from '@/hooks/use-session'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

type ToolbarMessageKey = 'search' | 'loading' | 'count' | 'filteredCount'

type StateMessageKey =
  | 'error.title'
  | 'error.description'
  | 'error.retry'
  | 'empty.title'
  | 'empty.description'
  | 'empty.viewOnlyDescription'

type ListTranslator<
  Key extends string = ToolbarMessageKey | StateMessageKey | 'caption' | 'noMatch',
> = (key: Key, values?: { count: number; total?: number }) => string

type ListQuery<Item> = {
  data: ReadonlyArray<Item> | undefined
  isError: boolean
  isPending: boolean
  refetch: () => void
}

export function NewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={buttonVariants()}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
      {label}
    </Link>
  )
}

export function ListEmpty({
  icon,
  title,
  description,
  viewOnlyDescription,
  action,
}: {
  icon: IconSvgElement
  title: string
  description: string
  viewOnlyDescription: string
  action?: ReactNode
}) {
  const canChange = useCanChange()

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{canChange ? description : viewOnlyDescription}</EmptyDescription>
      </EmptyHeader>
      {canChange && action !== undefined && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

export function ListStates<Item>({
  query,
  t,
  emptyIcon,
  emptyAction,
  children,
}: {
  query: ListQuery<Item>
  t: ListTranslator<StateMessageKey>
  emptyIcon: IconSvgElement
  emptyAction?: ReactNode
  children: ReactNode
}) {
  if (query.isError) {
    return (
      <LoadError
        description={t('error.description')}
        retryLabel={t('error.retry')}
        title={t('error.title')}
        onRetry={() => query.refetch()}
      />
    )
  }

  if (query.data?.length === 0) {
    return (
      <ListEmpty
        action={emptyAction}
        description={t('empty.description')}
        icon={emptyIcon}
        title={t('empty.title')}
        viewOnlyDescription={t('empty.viewOnlyDescription')}
      />
    )
  }

  return children
}

export function ListToolbar({
  t,
  search,
  onSearchChange,
  busy,
  filtered,
  count,
  total,
  children,
}: {
  t: ListTranslator<ToolbarMessageKey>
  search: string
  onSearchChange: (search: string) => void
  busy: boolean
  filtered: boolean
  count: number
  total: number
  children?: ReactNode
}) {
  const searchId = useId()

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <label htmlFor={searchId} className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        {children}
      </div>
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {busy
          ? t('loading')
          : filtered
            ? t('filteredCount', { count, total })
            : t('count', { count })}
      </p>
    </div>
  )
}

export function ListNoMatch({
  t,
  className,
}: {
  t: ListTranslator<'noMatch'>
  className?: string
}) {
  return <p className={cn('text-muted-foreground py-6 text-center', className)}>{t('noMatch')}</p>
}

function LoadingRows({ count, columns }: { count: number; columns: number }) {
  return Array.from({ length: count }, (_, row) => (
    <TableRow key={row}>
      {Array.from({ length: columns }, (_, column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full max-w-32" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

export function ListTable<Item>({
  query,
  pending,
  t,
  emptyIcon,
  newLink,
  emptyAction,
  toolbar,
  filter,
  columns,
  matches,
  row,
}: {
  query: ListQuery<Item>
  pending: boolean
  t: ListTranslator
  emptyIcon: IconSvgElement
  newLink?: { href: string; label: string }
  emptyAction?: ReactNode
  toolbar?: ReactNode
  filter?: ((item: Item) => boolean) | undefined
  columns: ReadonlyArray<{ key: string; label: string; hidden?: boolean }>
  matches: (item: Item, term: string) => boolean
  row: (item: Item) => ReactNode
}) {
  const [search, setSearch] = useState('')
  const busy = query.isPending || pending
  const term = search.trim().toLocaleLowerCase()
  const filtered = term !== '' || filter !== undefined

  const shown = (query.data ?? []).filter(
    (item) => (term === '' || matches(item, term)) && (filter === undefined || filter(item)),
  )

  return (
    <ListStates
      emptyAction={
        newLink || emptyAction ? (
          <>
            {newLink && <NewLink href={newLink.href} label={newLink.label} />}
            {emptyAction}
          </>
        ) : undefined
      }
      emptyIcon={emptyIcon}
      query={query}
      t={t}>
      <div className="flex flex-col gap-3">
        <ListToolbar
          busy={busy}
          count={shown.length}
          filtered={filtered}
          search={search}
          t={t}
          total={query.data?.length ?? 0}
          onSearchChange={setSearch}>
          {toolbar}
        </ListToolbar>
        <div className="@container rounded-lg border">
          <Table aria-busy={busy}>
            <TableCaption className="sr-only">{t('caption')}</TableCaption>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} scope="col">
                    {column.hidden ? <span className="sr-only">{column.label}</span> : column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <LoadingRows columns={columns.length} count={6} />
              ) : shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-0">
                    <ListNoMatch
                      t={t}
                      className="sticky left-0 w-[100cqw] px-2 whitespace-normal"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                shown.map(row)
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </ListStates>
  )
}
