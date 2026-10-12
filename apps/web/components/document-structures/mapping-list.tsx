'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { linkClass } from '@/components/detail-parts'
import { mappingHref } from '@/lib/navigation'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

export type Mappings = DocumentStructureSummary['mappings']

export function MappingList({ mappings, limit }: { mappings: Mappings; limit?: number }) {
  const t = useTranslations('DocumentStructures')
  const shown = limit === undefined ? mappings : mappings.slice(0, limit)
  const more = mappings.length - shown.length

  return (
    <ul className="flex min-w-0 flex-col">
      {shown.map((mapping) => (
        <li key={mapping.id} className="min-w-0">
          <Link
            href={mappingHref(mapping.id)}
            className={cn(linkClass, 'inline-block py-0.5 leading-5 break-words')}>
            {mapping.name}
          </Link>
        </li>
      ))}
      {more > 0 && (
        <li className="text-muted-foreground py-0.5">{t('moreMappings', { count: more })}</li>
      )}
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
