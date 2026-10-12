'use client'

import { type QueryKey, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'

import { documentTree, edifactTree, type TreeItem } from '@/components/mappings/mapping-tree'
import { getDocumentStructure, getMessageTypeStructure } from '@/lib/api/client'
import { documentStructureKeys, messageTypeKeys } from '@/lib/api/queries'

import type { Locale } from '@/i18n/locales'
import type { MappingSide } from '@edi-bridge/contracts'

// The sides load different structures, but past `select` the canvas only sees the tree; leaving
// the structure type out of the options lets one `useQuery` call serve both kinds of side.
function treeQuery<Data>(
  queryKey: QueryKey,
  queryFn: () => Promise<Data>,
  tree: (data: Data) => TreeItem[],
): UseQueryOptions<unknown, Error, TreeItem[]> {
  return {
    queryKey,
    queryFn,
    // SAFETY: `select` only receives what `queryFn` above returned, which is Data.
    select: (data) => tree(data as Data),
  }
}

function sideOf(
  side: MappingSide,
  t: ReturnType<typeof useTranslations<'Mapping'>>,
  locale: Locale,
) {
  switch (side.kind) {
    case 'documentStructure':
      return {
        title: t('side.documentStructure', { name: side.name }),
        query: treeQuery(
          documentStructureKeys.detail(side.documentStructureId),
          () => getDocumentStructure(side.documentStructureId),
          documentTree,
        ),
      }
    case 'messageType':
      return {
        title: t('side.messageType', { messageType: side.messageType }),
        query: treeQuery(
          messageTypeKeys.structure(side.messageType),
          () => getMessageTypeStructure(side.messageType),
          (structure) => edifactTree(structure, locale),
        ),
      }
  }
}

export function useSideTitle() {
  const t = useTranslations('Mapping')
  const locale = useLocale()

  return (side: MappingSide) => sideOf(side, t, locale).title
}

export function useSide(side: MappingSide) {
  const t = useTranslations('Mapping')
  const locale = useLocale()
  const { title, query } = sideOf(side, t, locale)
  const { data: items, isError, refetch } = useQuery(query)

  return { title, items, isError, refetch }
}

export type SideQuery = ReturnType<typeof useSide>
