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
import { codeTranslationHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader } from '@edi-bridge/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@edi-bridge/ui/components/dropdown-menu'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  Direction,
  LookupTableSummary,
  LookupTableUse,
  MessageType,
} from '@edi-bridge/contracts'

export type CardAction = (table: LookupTableSummary, trigger: HTMLElement | null) => void

export type CardActions = { onEdit: CardAction; onDelete: CardAction }

type UseGroup = { messageType: MessageType; direction: Direction; partners: Set<string> }

function byMessageType(uses: ReadonlyArray<LookupTableUse>) {
  const groups = new Map<MessageType, UseGroup>()

  for (const { messageType, direction, tradingPartners } of uses) {
    const group = groups.get(messageType) ?? { messageType, direction, partners: new Set() }

    for (const { name } of tradingPartners) {
      group.partners.add(name)
    }

    groups.set(messageType, group)
  }

  return [...groups.values()]
}

function UsesList({ uses }: { uses: ReadonlyArray<LookupTableUse> }) {
  const t = useTranslations('CodeTranslations.uses')
  const format = useFormatter()
  const plainNames = usePlainNames()
  const labelId = useId()

  if (uses.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p id={labelId} className="text-muted-foreground text-xs">
        {t('label')}
      </p>
      <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
        {byMessageType(uses).map(({ messageType, direction, partners }) => {
          const documents = plainNames.messageTypeName(messageType, true)

          return (
            <li key={messageType}>
              {partners.size === 0
                ? documents
                : t('use', { documents, direction, partners: format.list([...partners]) })}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ActionsMenu({ table, actions }: { table: LookupTableSummary; actions: CardActions }) {
  const t = useTranslations('CodeTranslations.actions')
  const trigger = useRef<HTMLButtonElement>(null)

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
        <DropdownMenuItem
          variant="destructive"
          onClick={() => actions.onDelete(table, trigger.current)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CodeTranslationCard({
  table,
  actions,
}: {
  table: LookupTableSummary
  actions: CardActions | null
}) {
  const t = useTranslations('CodeTranslations')
  const titleId = useId()
  const href = codeTranslationHref(table.id)
  const blocking = table.missingCodeCounts.blocking

  return (
    <Card className={cn('h-full', blocking > 0 && 'ring-destructive/40')}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="font-heading min-w-0 text-base leading-snug font-medium">
          <Link href={href} className="break-words hover:underline">
            {table.name}
          </Link>
        </h3>
        {blocking > 0 && (
          <Badge variant="outline" className="bg-red-500/10 text-red-800 dark:text-red-300">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
            {t('blocking', { count: blocking })}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          {t(`kinds.${table.kind}`)} &middot;{' '}
          <span className="tabular-nums">{t('valueCount', { count: table.entryCount })}</span>
        </p>
        <UsesList uses={table.uses} />
      </CardContent>
      <CardFooter className="mt-auto flex items-center justify-end gap-2 py-3">
        {actions && <ActionsMenu actions={actions} table={table} />}
        <Link
          href={href}
          aria-describedby={titleId}
          className={buttonVariants({ size: 'sm', variant: blocking > 0 ? 'default' : 'outline' })}>
          {t('open')}
        </Link>
      </CardFooter>
    </Card>
  )
}
