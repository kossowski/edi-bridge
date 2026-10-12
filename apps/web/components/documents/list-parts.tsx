'use client'

import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { type DocumentFilters, listPageSize } from '@/components/documents/document-filters'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'

export type EmptyAction = 'clear' | 'firstPage'

export type ResultsProps = {
  filters: DocumentFilters
  onChange: (change: Partial<DocumentFilters>) => void
  onClear: () => void
}

export function ListEmpty({
  icon,
  title,
  description,
  action,
  onClear,
  onFirstPage,
}: {
  icon: IconSvgElement
  title: string
  description: string
  action: EmptyAction | undefined
  onClear: () => void
  onFirstPage: () => void
}) {
  const t = useTranslations('Documents')

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action === 'clear' && (
        <EmptyContent>
          <Button variant="outline" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        </EmptyContent>
      )}
      {action === 'firstPage' && (
        <EmptyContent>
          <Button variant="outline" onClick={onFirstPage}>
            {t('pagination.first')}
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
  const t = useTranslations('Documents.pagination')
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
