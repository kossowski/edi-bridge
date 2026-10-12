'use client'

import {
  documentFiltersSearch,
  parseDocumentFilters,
} from '@/components/documents/document-filters'
import { useUrlFilters } from '@/hooks/use-url-filters'

export function useDocumentFilters() {
  return useUrlFilters(parseDocumentFilters, documentFiltersSearch)
}
