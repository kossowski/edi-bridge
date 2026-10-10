'use client'

import { HierarchySquare02Icon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { linkClass } from '@/components/detail-parts'
import { ListScreen, ListTable } from '@/components/list-screen'
import { documentStructuresQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

const columns = ['name', 'format', 'fields', 'mappings'] as const

export function UsedByMappings({ mappings }: { mappings: DocumentStructureSummary['mappings'] }) {
  const t = useTranslations('DocumentStructures')

  if (mappings.length === 0) {
    return <span className="text-muted-foreground">{t('notUsed')}</span>
  }

  return (
    <ul className="flex flex-col gap-1">
      {mappings.map((mapping) => (
        <li key={mapping.id}>
          <Link href={`/mappings/${mapping.id}`} className={linkClass}>
            {mapping.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function DocumentStructureRow({ summary }: { summary: DocumentStructureSummary }) {
  const t = useTranslations('DocumentStructures')

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <Link href={`/document-structures/${summary.id}`} className={linkClass}>
          {summary.name}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{t(`format.${summary.format}`)}</Badge>
      </TableCell>
      <TableCell className="tabular-nums">
        {t('fieldCount', { count: summary.fieldCount })}
      </TableCell>
      <TableCell className="whitespace-normal">
        <UsedByMappings mappings={summary.mappings} />
      </TableCell>
    </TableRow>
  )
}

export function DocumentStructuresScreen() {
  const t = useTranslations()
  const tList = useTranslations('DocumentStructures')
  const summaries = useQuery(documentStructuresQuery)
  const newLink = { href: '/document-structures/new', label: tList('new') }

  return (
    <ListScreen newLink={newLink} title={t('Navigation.documentStructures')}>
      <ListTable
        columns={columns.map((key) => ({ key, label: tList(`columns.${key}`) }))}
        emptyIcon={HierarchySquare02Icon}
        matches={(summary, term) =>
          [summary.name, ...summary.mappings.map(({ name }) => name)].some((text) =>
            text.toLocaleLowerCase().includes(term),
          )
        }
        newLink={newLink}
        pending={false}
        query={summaries}
        row={(summary) => <DocumentStructureRow key={summary.id} summary={summary} />}
        t={tList}
      />
    </ListScreen>
  )
}
