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

type ListMessageKey =
  | 'search'
  | 'loading'
  | 'count'
  | 'filteredCount'
  | 'caption'
  | 'noMatch'
  | 'error.title'
  | 'error.description'
  | 'error.retry'
  | 'empty.title'
  | 'empty.description'
  | 'empty.viewOnlyDescription'

type ListTranslator = (key: ListMessageKey, values?: { count: number; total?: number }) => string

export function NewLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={buttonVariants()}>
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
      {label}
    </Link>
  )
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
  query: {
    data: ReadonlyArray<Item> | undefined
    isError: boolean
    isPending: boolean
    refetch: () => void
  }
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
  const searchId = useId()
  const [search, setSearch] = useState('')
  const canChange = useCanChange()

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
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={emptyIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>
            {canChange ? t('empty.description') : t('empty.viewOnlyDescription')}
          </EmptyDescription>
        </EmptyHeader>
        {canChange && (newLink || emptyAction) && (
          <EmptyContent>
            {newLink && <NewLink href={newLink.href} label={newLink.label} />}
            {emptyAction}
          </EmptyContent>
        )}
      </Empty>
    )
  }

  const busy = query.isPending || pending
  const term = search.trim().toLocaleLowerCase()
  const filtered = term !== '' || filter !== undefined

  const shown = (query.data ?? []).filter(
    (item) => (term === '' || matches(item, term)) && (filter === undefined || filter(item)),
  )

  return (
    <div className="flex flex-col gap-3">
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
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {toolbar}
        </div>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {busy
            ? t('loading')
            : !filtered
              ? t('count', { count: shown.length })
              : t('filteredCount', { count: shown.length, total: query.data?.length ?? 0 })}
        </p>
      </div>
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
                  <p className="text-muted-foreground sticky left-0 w-[100cqw] px-2 py-6 text-center whitespace-normal">
                    {t('noMatch')}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              shown.map(row)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
