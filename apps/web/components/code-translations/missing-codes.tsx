'use client'

import { Add01Icon, Alert02Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { ActionError } from '@/components/documents/action-error'
import { usePlainNames } from '@/components/plain-names'
import { documentHref } from '@/lib/navigation'
import {
  type BlockingMissingCode,
  directionOf,
  type FailedRunReference,
  type MissingCode,
  type UpcomingMissingCode,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

const shownPerGroup = 10

export function useDocumentTitle() {
  const t = useTranslations('Documents.row')
  const plainNames = usePlainNames()

  return (run: FailedRunReference) => {
    const values = {
      direction: directionOf(run),
      messageType: plainNames.messageTypeName(run.messageType),
      tradingPartner: run.tradingPartner.name,
    }

    return run.businessReference === null
      ? t('titleWithoutReference', values)
      : t('title', { ...values, reference: run.businessReference })
  }
}

export function FailedRunLink({ run }: { run: FailedRunReference }) {
  const format = useFormatter()
  const title = useDocumentTitle()

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <Link href={documentHref(run.id)} className={linkClass}>
        {title(run)}
      </Link>
      <time dateTime={run.receivedAt} className="text-xs tabular-nums">
        {format.dateTime(new Date(run.receivedAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
    </span>
  )
}

function CodeName({ code }: { code: MissingCode }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="font-mono font-medium sm:text-base">{code.code}</span>
      {code.meaning && <span className="text-muted-foreground text-xs">{code.meaning}</span>}
    </span>
  )
}

function AddButton({ code, onAdd }: { code: string; onAdd: ((code: string) => void) | null }) {
  const t = useTranslations('CodeTranslation.missing')

  return (
    onAdd && (
      <Button size="sm" variant="outline" onClick={() => onAdd(code)}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
        {t('add', { code })}
      </Button>
    )
  )
}

function BlockingItem({
  code,
  onAdd,
}: {
  code: BlockingMissingCode
  onAdd: ((code: string) => void) | null
}) {
  const t = useTranslations('CodeTranslation.missing.blocking')
  const seenId = useId()

  return (
    <li className="border-destructive/40 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <CodeName code={code} />
          <Badge variant="outline" className="bg-red-500/10 text-red-800 dark:text-red-300">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
            {t('stopped', { count: code.failedRuns.length })}
          </Badge>
        </span>
        <AddButton code={code.code} onAdd={onAdd} />
      </div>
      <p id={seenId} className="text-muted-foreground text-xs">
        {t('seenIn')}
      </p>
      <ul aria-labelledby={seenId} className="flex flex-col gap-1 text-sm">
        {code.failedRuns.map((run) => (
          <li key={run.id}>
            <FailedRunLink run={run} />
          </li>
        ))}
      </ul>
    </li>
  )
}

function UpcomingItem({
  code,
  onAdd,
}: {
  code: UpcomingMissingCode
  onAdd: ((code: string) => void) | null
}) {
  const t = useTranslations('CodeTranslation.missing.upcoming')

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <CodeName code={code} />
        <span className="text-muted-foreground text-xs">
          {t('items', { count: code.itemCount })}
        </span>
      </span>
      <AddButton code={code.code} onAdd={onAdd} />
    </li>
  )
}

function Group<Code extends MissingCode>({
  title,
  description,
  icon,
  codes,
  renderItem,
}: {
  title: string
  description: string
  icon: IconSvgElement
  codes: ReadonlyArray<Code>
  renderItem: (code: Code) => ReactNode
}) {
  const t = useTranslations('CodeTranslation.missing')
  const headingId = useId()
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? codes : codes.slice(0, shownPerGroup)

  if (codes.length === 0) {
    return null
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
          <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden className="size-4" />
          {title}{' '}
          <span className="text-muted-foreground font-normal tabular-nums">({codes.length})</span>
        </h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <ul id={listId} className="flex flex-col gap-2">
        {shown.map(renderItem)}
      </ul>
      {shown.length < codes.length && (
        <Button
          variant="outline"
          aria-controls={listId}
          className="self-start"
          onClick={() => setExpanded(true)}>
          {t('showAll', { count: codes.length })}
        </Button>
      )}
    </section>
  )
}

function byUrgency(codes: ReadonlyArray<MissingCode>) {
  const blocking: BlockingMissingCode[] = []
  const upcoming: UpcomingMissingCode[] = []

  for (const code of codes) {
    if (code.urgency === 'blocking') {
      blocking.push(code)
    } else {
      upcoming.push(code)
    }
  }

  return { blocking, upcoming }
}

export function MissingCodes({
  codes,
  isPending,
  isError,
  onAdd,
}: {
  codes: ReadonlyArray<MissingCode> | undefined
  isPending: boolean
  isError: boolean
  onAdd: ((code: string) => void) | null
}) {
  const t = useTranslations('CodeTranslation.missing')
  const headingId = useId()

  if (isError) {
    return <ActionError message={t('unavailable')} />
  }

  if (isPending || !codes) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <p role="status" className="sr-only">
          {t('loading')}
        </p>
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (codes.length === 0) {
    return null
  }

  const { blocking, upcoming } = byUrgency(codes)

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-4 rounded-xl border p-4',
        blocking.length > 0 && 'ring-destructive/40 ring-1',
      )}>
      <h2 id={headingId} className="text-base font-semibold">
        {t('title')}
      </h2>
      <Group
        codes={blocking}
        description={t('blocking.description')}
        icon={Alert02Icon}
        renderItem={(code) => <BlockingItem key={code.code} code={code} onAdd={onAdd} />}
        title={t('blocking.title')}
      />
      <Group
        codes={upcoming}
        description={t('upcoming.description')}
        icon={Clock01Icon}
        renderItem={(code) => <UpcomingItem key={code.code} code={code} onAdd={onAdd} />}
        title={t('upcoming.title')}
      />
    </section>
  )
}
