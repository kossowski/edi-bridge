'use client'

import { ArrowLeft01Icon, ArrowRight01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import type { UseQueryResult } from '@tanstack/react-query'

import { LoadError } from '@/components/load-error'
import { listPageSize } from '@/lib/search-params'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@edi-bridge/ui/components/input-group'
import { cn } from '@edi-bridge/ui/lib/utils'

const searchDelay = 300

export function SearchField({
  value,
  label,
  onSearch,
}: {
  value: string
  label: string
  onSearch: (q: string) => void
}) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const searched = useRef(value)

  if (value !== shown) {
    setShown(value)
    setText(value)
  }

  useEffect(() => {
    if (value !== searched.current) {
      searched.current = value
      clearTimeout(timer.current)
    }
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <InputGroup className="min-w-[min(100%,22rem)] flex-1 sm:max-w-sm">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        autoComplete="off"
        placeholder={label}
        type="search"
        value={text}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value

          setText(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            searched.current = next
            onSearch(next)
          }, searchDelay)
        }}
      />
    </InputGroup>
  )
}

export type EmptyAction = { label: string; onClick: () => void }

export function ListEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: IconSvgElement
  title: string
  description: string
  action: EmptyAction | undefined
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

export function Pagination({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const t = useTranslations('Pagination')
  const pageCount = Math.max(1, Math.ceil(total / listPageSize))

  if (pageCount === 1) {
    return null
  }

  return (
    <nav aria-label={t('label')} className="flex items-center justify-end gap-3">
      <p className="text-sm tabular-nums">{t('page', { page, pageCount })}</p>
      <div className="flex items-center gap-1">
        <Button
          disabled={page <= 1}
          size="icon-sm"
          variant="outline"
          aria-label={t('previous')}
          onClick={() => onPage(page - 1)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <Button
          disabled={page >= pageCount}
          size="icon-sm"
          variant="outline"
          aria-label={t('next')}
          onClick={() => onPage(page + 1)}>
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
      </div>
    </nav>
  )
}

export function ListResults<List extends { total: number }, Entry>({
  query: { data, isError, isPending, isPlaceholderData, refetch },
  page,
  onPage,
  entries,
  renderEntry,
  skeleton,
  skeletonCount,
  label,
  className,
  error,
  empty,
}: {
  query: UseQueryResult<List>
  page: number
  onPage: (page: number) => void
  entries: (list: List) => ReadonlyArray<Entry>
  renderEntry: (entry: Entry) => ReactNode
  skeleton: ReactNode
  skeletonCount: number
  label: string
  className?: string
  error: { title: string; description: string; retry: string }
  empty: (list: List) => ReactNode
}) {
  const listId = useId()
  const settled = isPlaceholderData ? undefined : data

  if (isError && !data) {
    return (
      <LoadError
        description={error.description}
        retryLabel={error.retry}
        title={error.title}
        onRetry={() => void refetch()}
      />
    )
  }

  if (settled && entries(settled).length === 0) {
    return empty(settled)
  }

  const shown = data && !(isPlaceholderData && entries(data).length === 0) ? data : undefined

  return (
    <>
      <ul
        id={listId}
        aria-busy={isPending || isPlaceholderData}
        aria-label={label}
        className={cn(
          'flex flex-col gap-2',
          isPlaceholderData && 'opacity-60 transition-opacity',
          className,
        )}>
        {shown
          ? entries(shown).map(renderEntry)
          : Array.from({ length: skeletonCount }, (_, index) => (
              <Fragment key={index}>{skeleton}</Fragment>
            ))}
      </ul>
      {data && (
        <Pagination
          page={page}
          total={data.total}
          onPage={(next) => {
            onPage(next)
            document.getElementById(listId)?.scrollIntoView({ block: 'start' })
          }}
        />
      )}
    </>
  )
}
