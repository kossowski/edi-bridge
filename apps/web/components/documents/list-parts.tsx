'use client'

import { useTranslations } from 'next-intl'

import type { ResultsProps } from '@/components/documents/document-filters'

export function useEmptyActions({ onChange, onClear }: Pick<ResultsProps, 'onChange' | 'onClear'>) {
  const t = useTranslations('Documents')
  const tPagination = useTranslations('Pagination')

  return {
    nothingMatches: { label: t('filters.clear'), onClick: onClear },
    pageOutOfRange: { label: tPagination('first'), onClick: () => onChange({ page: 1 }) },
  }
}
