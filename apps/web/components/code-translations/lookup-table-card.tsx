'use client'

import {
  Alert02Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef } from 'react'

import { usePlainNames } from '@/components/plain-names'
import { lookupTableHref, mappingHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader } from '@edi-bridge/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { LookupTableSummary, LookupTableUse } from '@edi-bridge/contracts'

export type CardAction = (table: LookupTableSummary, trigger: HTMLElement | null) => void

export type CardActions = { onEdit: CardAction; onDelete: CardAction }

const shownUses = 3

const namedCodes = 2

export function hasBlockingCodes(table: Pick<LookupTableSummary, 'blockingCodes'>) {
  return table.blockingCodes.length > 0
}

function useUseSentence() {
  const t = useTranslations('CodeTranslations.uses')
  const format = useFormatter()
  const plainNames = usePlainNames()

  return ({ messageType, direction, tradingPartners }: LookupTableUse) => {
    const documents = plainNames.messageTypeName(messageType, true)

    if (tradingPartners.length === 0) {
      return documents
    }

    const partners = format.list(tradingPartners.map(({ name }) => name))

    return t('use', { documents, direction, partners })
  }
}

export function UsesList({
  uses,
  showAll = false,
}: {
  uses: ReadonlyArray<LookupTableUse>
  showAll?: boolean
}) {
  const t = useTranslations('CodeTranslations.uses')
  const sentence = useUseSentence()
  const labelId = useId()

  if (uses.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  const shown = showAll ? uses : uses.slice(0, shownUses)
  const hidden = uses.length - shown.length

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p id={labelId} className="text-muted-foreground text-xs">
        {t('label')}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {shown.map((use) => (
          <li key={use.mappingId}>
            <Link
              href={mappingHref(use.mappingId)}
              className="decoration-muted-foreground/50 hover:decoration-foreground focus-visible:ring-ring/50 inline-block rounded-sm py-0.5 underline underline-offset-4 outline-none focus-visible:ring-3">
              {sentence(use)}
            </Link>
          </li>
        ))}
        {hidden > 0 && <li className="text-muted-foreground">{t('more', { count: hidden })}</li>}
      </ul>
    </div>
  )
}

function BlockingBadge({ codes }: { codes: ReadonlyArray<string> }) {
  const t = useTranslations('CodeTranslations')
  const format = useFormatter()
  const hidden = codes.length - namedCodes
  const named = codes.slice(0, namedCodes)

  return (
    <Badge variant="outline" className="bg-red-500/10 text-red-800 dark:text-red-300">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
      {t('missing', {
        count: codes.length,
        codes: format.list(hidden > 0 ? [...named, t('moreCodes', { count: hidden })] : named),
      })}
    </Badge>
  )
}

function ActionsMenu({ table, actions }: { table: LookupTableSummary; actions: CardActions }) {
  const t = useTranslations('CodeTranslations.actions')
  const format = useFormatter()
  const trigger = useRef<HTMLButtonElement>(null)
  const reasonId = useId()
  const inUse = table.uses.length > 0

  function mappingNames(uses: ReadonlyArray<LookupTableUse>) {
    const named = uses.slice(0, shownUses).map(({ name }) => name)
    const hidden = uses.length - named.length

    return format.list(hidden > 0 ? [...named, t('moreMappings', { count: hidden })] : named)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        render={
          <Button size="icon-sm" variant="ghost" aria-label={t('label', { name: table.name })} />
        }>
        <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => actions.onEdit(table, trigger.current)}>
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
          {t('edit')}
        </DropdownMenuItem>
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={inUse}
            variant="destructive"
            aria-describedby={inUse ? reasonId : undefined}
            onClick={() => actions.onDelete(table, trigger.current)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
            {t('delete')}
          </DropdownMenuItem>
          {inUse && (
            <p id={reasonId} className="text-muted-foreground max-w-64 px-1.5 pb-1 text-xs">
              {t('inUse', { mappings: mappingNames(table.uses) })}
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function LookupTableCard({
  table,
  actions,
}: {
  table: LookupTableSummary
  actions: CardActions | null
}) {
  const t = useTranslations('CodeTranslations')
  const titleId = useId()
  const href = lookupTableHref(table.id)
  const [firstBlockingCode] = table.blockingCodes

  return (
    <Card className={cn('h-full', hasBlockingCodes(table) && 'ring-destructive/40')}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="font-heading min-w-0 text-base leading-snug font-medium">
          <Link
            href={href}
            className="focus-visible:ring-ring/50 rounded-sm break-words outline-none hover:underline focus-visible:ring-3">
            {table.name}
          </Link>
        </h3>
        {hasBlockingCodes(table) && <BlockingBadge codes={table.blockingCodes} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          {t(`kinds.${table.kind}`)} &middot;{' '}
          <span className="tabular-nums">{t('valueCount', { count: table.entryCount })}</span>
        </p>
        <UsesList uses={table.uses} />
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap items-center justify-end gap-2 py-3">
        {actions && <ActionsMenu actions={actions} table={table} />}
        <Link
          href={href}
          aria-describedby={titleId}
          className={cn(
            buttonVariants({ size: 'sm', variant: 'outline' }),
            'border-foreground/20 dark:border-input',
          )}>
          {t('open')}
        </Link>
        {firstBlockingCode !== undefined && (
          <Link
            href={`${href}?${new URLSearchParams({ add: firstBlockingCode })}`}
            aria-describedby={titleId}
            className={buttonVariants({ size: 'sm' })}>
            {t('add', { code: firstBlockingCode })}
          </Link>
        )}
      </CardFooter>
    </Card>
  )
}
