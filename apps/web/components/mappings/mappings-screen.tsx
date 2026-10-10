'use client'

import { FlowConnectionIcon } from '@hugeicons/core-free-icons'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { ListScreen, ListTable } from '@/components/list-screen'
import { mappingsQuery } from '@/lib/api/queries'
import { TableCell, TableRow } from '@edi-bridge/ui/components/table'

import type { MappingSummary } from '@edi-bridge/contracts'

const columns = ['name', 'direction', 'messageType', 'documentStructure', 'latestVersion'] as const

function MappingRow({ mapping }: { mapping: MappingSummary }) {
  const t = useTranslations('Mappings')

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/mappings/${mapping.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {mapping.name}
        </Link>
      </TableCell>
      <TableCell>{t(`direction.${mapping.direction}`)}</TableCell>
      <TableCell>
        <code className="font-mono text-xs">{mapping.messageType}</code>
      </TableCell>
      <TableCell>{mapping.documentStructureName}</TableCell>
      <TableCell>
        {mapping.latestVersion === null ? (
          <span className="text-muted-foreground">{t('neverPublished')}</span>
        ) : (
          t('version', { version: mapping.latestVersion })
        )}
      </TableCell>
    </TableRow>
  )
}

export function MappingsScreen() {
  const t = useTranslations()
  const tMappings = useTranslations('Mappings')
  const mappings = useQuery(mappingsQuery)

  return (
    <ListScreen title={t('Navigation.mappings')}>
      <ListTable
        columns={columns.map((key) => ({ key, label: tMappings(`columns.${key}`) }))}
        emptyIcon={FlowConnectionIcon}
        matches={(mapping, term) =>
          [mapping.name, mapping.messageType, mapping.documentStructureName].some((text) =>
            text.toLocaleLowerCase().includes(term),
          )
        }
        pending={false}
        query={mappings}
        row={(mapping) => <MappingRow key={mapping.id} mapping={mapping} />}
        t={tMappings}
      />
    </ListScreen>
  )
}
