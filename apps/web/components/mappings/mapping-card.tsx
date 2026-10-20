'use client'

import { AiMagicIcon, Alert02Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import { documentsHref } from '@/components/documents/document-filters'
import { aiDraftStartHref } from '@/components/mappings/ai-draft-run'
import { DirectionPath } from '@/components/mappings/direction-path'
import { mappingState, type MappingState } from '@/components/mappings/mapping-state'
import { StateBadge } from '@/components/mappings/state-badge'
import { usePlainNames } from '@/components/plain-names'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader } from '@edi-bridge/ui/components/card'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { MappingSummary } from '@edi-bridge/contracts'

export function useMappingTitle(mapping: MappingSummary) {
  const t = useTranslations('Mappings.title')
  const documents = usePlainNames().messageTypeName(mapping.messageType, true)
  const [first, ...others] = mapping.partners

  if (!first) {
    return documents
  }

  if (others.length === 0) {
    return t('onePartner', { documents, direction: mapping.direction, partner: first.name })
  }

  return t('partners', {
    documents,
    direction: mapping.direction,
    count: mapping.partners.length,
  })
}

export function MappingStateBadge({ state }: { state: MappingState }) {
  const t = useTranslations('Mappings.state')

  return <StateBadge state={state}>{t(state)}</StateBadge>
}

function StatusLine({ mapping, state }: { mapping: MappingSummary; state: MappingState }) {
  const t = useTranslations('Mappings.status')

  switch (state) {
    case 'failing':
      return (
        <p className="text-destructive-text font-medium">
          {t('failed', { count: mapping.failedRunsLast7Days })}
          {mapping.unpublishedChanges && (
            <span className="text-muted-foreground font-normal"> · {t('unpublished')}</span>
          )}
        </p>
      )
    case 'draft':
      return <p className="font-medium">{t('unpublished')}</p>
    case 'new':
      return <p className="text-muted-foreground">{t('nothingYet')}</p>
    case 'live':
      return (
        <p className="text-muted-foreground">
          {t('translated', { count: mapping.documentsLast7Days })}
        </p>
      )
  }
}

function MappingPath({ mapping }: { mapping: MappingSummary }) {
  const t = useTranslations('Mappings.path')
  const format = useFormatter()
  const names = mapping.partners.map(({ name }) => name)
  const partnerText = names.length > 0 ? format.list(names) : t('noPartner')

  return (
    <DirectionPath
      direction={mapping.direction}
      erp={
        <span className="min-w-0 sm:truncate">
          <span className="sr-only">{t('documentStructure')} </span>
          {mapping.documentStructureName}
        </span>
      }
      partner={
        <span title={partnerText} className="min-w-0 sm:truncate">
          {partnerText}
        </span>
      }
      className="bg-muted/50 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] rounded-lg px-3 py-2 text-xs"
    />
  )
}

function nextAction(mappingId: string, state: MappingState) {
  const href = `/mappings/${mappingId}`

  switch (state) {
    case 'failing':
      return { href: documentsHref({ status: 'attention', mappingId }), icon: Alert02Icon }
    case 'draft':
      return { href, icon: PencilEdit02Icon }
    case 'new':
      return { href: aiDraftStartHref(mappingId), icon: AiMagicIcon }
    case 'live':
      return { href, icon: null }
  }
}

function NextAction({
  mappingId,
  state,
  describedBy,
}: {
  mappingId: string
  state: MappingState
  describedBy: string
}) {
  const t = useTranslations('Mappings.action')
  const { href, icon } = nextAction(mappingId, state)

  return (
    <Link
      href={href}
      aria-describedby={describedBy}
      className={buttonVariants({ size: 'sm', variant: state === 'live' ? 'outline' : 'default' })}>
      {icon && <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden data-icon="inline-start" />}
      {t(state)}
    </Link>
  )
}

export function MappingCard({ mapping }: { mapping: MappingSummary }) {
  const t = useTranslations('Mappings')
  const format = useFormatter()
  const titleId = useId()
  const state = mappingState(mapping)
  const title = useMappingTitle(mapping)
  const href = `/mappings/${mapping.id}`

  return (
    <Card
      className={cn(
        state === 'failing' && 'ring-destructive/40',
        state === 'draft' && 'ring-amber-500/40',
      )}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="font-heading text-base leading-snug font-medium">
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </h3>
        <MappingStateBadge state={state} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MappingPath mapping={mapping} />
        <StatusLine mapping={mapping} state={state} />
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2 py-3">
        <span className="text-muted-foreground text-xs">
          {mapping.latestVersion !== null && mapping.latestVersionPublishedAt !== null
            ? t('liveSince', {
                version: mapping.latestVersion,
                date: format.dateTime(new Date(mapping.latestVersionPublishedAt), {
                  dateStyle: 'medium',
                }),
              })
            : t('neverPublished')}
        </span>
        <NextAction describedBy={titleId} mappingId={mapping.id} state={state} />
      </CardFooter>
    </Card>
  )
}
