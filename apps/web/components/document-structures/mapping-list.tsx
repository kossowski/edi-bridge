'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { linkClass } from '@/components/detail-parts'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

type Mappings = DocumentStructureSummary['mappings']

export function MappingList({ mappings }: { mappings: Mappings }) {
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

export function UsedByMappings({ mappings }: { mappings: Mappings }) {
  const t = useTranslations('DocumentStructures')

  if (mappings.length === 0) {
    return <span className="text-muted-foreground">{t('notUsed')}</span>
  }

  return <MappingList mappings={mappings} />
}
