'use client'

import { Alert02Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useId, useRef, useState } from 'react'

import { newestFirst } from '@/components/code-translations/lookup-table-entries'
import {
  focusOnMount,
  type MeaningOf,
  revealOnMount,
  SentAs,
  useValidation,
} from '@/components/code-translations/value-row'
import { linkClass } from '@/components/detail-parts'
import { ActionError } from '@/components/documents/action-error'
import { useRunTitle } from '@/components/documents/run-title'
import { documentHref } from '@/lib/navigation'
import {
  type BlockingMissingCode,
  type Direction,
  type FailedRunReference,
  type LookupTableEntry,
  type MissingCode,
  type UpcomingMissingCode,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

const shownPerGroup = 10

const shownRuns = 3

export type Accept = (entry: LookupTableEntry) => void

type RowContext = {
  direction: Direction
  entries: ReadonlyArray<LookupTableEntry>
  highlighted: string | null
  meaningOf: MeaningOf
  saving: boolean
  onAccept: Accept | null
}

export function FailedRunLink({ run }: { run: FailedRunReference }) {
  const format = useFormatter()
  const title = useRunTitle(run)

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <Link href={documentHref(run.id)} className={cn(linkClass, 'inline-block py-0.5')}>
        {title}
      </Link>
      <time dateTime={run.receivedAt} className="text-xs tabular-nums">
        {format.dateTime(new Date(run.receivedAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
    </span>
  )
}

export function RunLinks({ runs }: { runs: ReadonlyArray<FailedRunReference> }) {
  const t = useTranslations('CodeTranslation.missing.blocking')
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? runs : runs.slice(0, shownRuns)

  return (
    <>
      <ul id={listId} className="flex flex-col gap-1 text-sm">
        {shown.map((run) => (
          <li key={run.id}>
            <FailedRunLink run={run} />
          </li>
        ))}
      </ul>
      {shown.length < runs.length && (
        <Button
          size="sm"
          variant="outline"
          aria-controls={listId}
          className="self-start"
          onClick={() => setExpanded(true)}>
          {t('seenAll', { count: runs.length })}
        </Button>
      )}
    </>
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

function StopsReason({ newest, more }: { newest: FailedRunReference; more: number }) {
  const t = useTranslations('CodeTranslation.missing')
  const title = useRunTitle(newest)

  return (
    <span className="text-destructive-text font-medium">
      {t('stops', { document: title, more })}
    </span>
  )
}

function Reason({ code }: { code: MissingCode }) {
  const t = useTranslations('CodeTranslation.missing.upcoming')

  if (code.urgency === 'upcoming') {
    return <span>{t('items', { count: code.itemCount })}</span>
  }

  const [newest, ...older] = newestFirst(code.failedRuns)

  return newest && <StopsReason more={older.length} newest={newest} />
}

function AcceptForm({
  code,
  context,
  onAccept,
}: {
  code: MissingCode
  context: RowContext
  onAccept: Accept
}) {
  const t = useTranslations('CodeTranslation')
  const inputId = useId()
  const problemId = `${inputId}-problem`
  const orId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [targetCode, setTargetCode] = useState(code.suggestions[0]?.code ?? '')
  const validation = useValidation(context.entries, null)
  const draft = { sourceCode: code.code, targetCode }
  const problem = validation.messagesFor(draft).targetCode
  const chosen = targetCode.trim()
  const meaning = chosen === '' ? null : context.meaningOf(chosen)
  const others = code.suggestions.filter((suggestion) => suggestion.code !== chosen)
  const highlighted = context.highlighted === code.code

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => validation.submit(event, draft, onAccept)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <span className="flex min-h-8 items-center">
          <CodeName code={code} />
        </span>
        <span className="flex items-start gap-2">
          <span className="flex h-8 items-center">
            <SentAs direction={context.direction} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:w-32 sm:flex-none">
            <label htmlFor={inputId} className="sr-only">
              {t('missing.sendAs', { direction: context.direction, code: code.code })}
            </label>
            <Input
              id={inputId}
              autoComplete="off"
              ref={(element) => {
                input.current = element

                if (highlighted) {
                  focusOnMount(element)
                }
              }}
              spellCheck={false}
              value={targetCode}
              aria-describedby={problem ? problemId : undefined}
              aria-invalid={problem ? true : undefined}
              className="font-mono"
              onChange={(event) => setTargetCode(event.target.value)}
            />
          </span>
          <Button
            disabled={context.saving}
            type="submit"
            aria-label={t('missing.acceptCode', { code: code.code })}
            className="shrink-0">
            {t('missing.accept')}
          </Button>
        </span>
      </div>
      {problem && (
        <p id={problemId} className="text-destructive-text text-xs sm:self-end">
          {problem}
        </p>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Reason code={code} />
        {meaning && <span>{t('values.meaning', { code: chosen, meaning })}</span>}
        {others.length > 0 && (
          <span role="group" aria-labelledby={orId} className="flex flex-wrap items-center gap-1">
            <span id={orId}>{t('missing.or')}</span>
            {others.map((suggestion) => (
              <Button
                key={suggestion.code}
                size="xs"
                type="button"
                variant="outline"
                aria-label={t('missing.useSuggestion', {
                  code: suggestion.code,
                  meaning: suggestion.meaning,
                })}
                className="font-mono"
                onClick={() => {
                  setTargetCode(suggestion.code)
                  input.current?.focus()
                }}>
                {suggestion.code}
              </Button>
            ))}
          </span>
        )}
      </div>
    </form>
  )
}

function MissingCodeItem({ code, context }: { code: MissingCode; context: RowContext }) {
  const t = useTranslations('CodeTranslation.missing.blocking')
  const seenId = useId()
  const highlighted = context.highlighted === code.code

  return (
    <li
      ref={highlighted ? revealOnMount : undefined}
      className={cn(
        'flex scroll-mt-20 flex-col gap-2 rounded-lg border p-3',
        code.urgency === 'blocking' && 'border-destructive/40',
        highlighted && 'ring-primary ring-2',
      )}>
      {context.onAccept ? (
        <AcceptForm code={code} context={context} onAccept={context.onAccept} />
      ) : (
        <>
          <CodeName code={code} />
          <p className="text-muted-foreground text-xs">
            <Reason code={code} />
          </p>
        </>
      )}
      {code.urgency === 'blocking' && (
        <div role="group" aria-labelledby={seenId} className="flex flex-col gap-1">
          <p id={seenId} className="text-muted-foreground text-xs">
            {t('seenIn')}
          </p>
          <RunLinks runs={newestFirst(code.failedRuns)} />
        </div>
      )}
    </li>
  )
}

function Group({
  title,
  description,
  icon,
  codes,
  highlighted,
  renderItem,
}: {
  title: string
  description: string
  icon: IconSvgElement
  codes: ReadonlyArray<MissingCode>
  highlighted: string | null
  renderItem: (code: MissingCode) => ReactNode
}) {
  const t = useTranslations('CodeTranslation.missing')
  const headingId = useId()
  const listId = useId()

  const [expanded, setExpanded] = useState(
    () => codes.findIndex(({ code }) => code === highlighted) >= shownPerGroup,
  )

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
  ...context
}: RowContext & {
  codes: ReadonlyArray<MissingCode> | undefined
  isPending: boolean
  isError: boolean
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

  const renderItem = (code: MissingCode) => (
    <MissingCodeItem key={code.code} code={code} context={context} />
  )

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
        highlighted={context.highlighted}
        icon={Alert02Icon}
        renderItem={renderItem}
        title={t('blocking.title')}
      />
      <Group
        codes={upcoming}
        description={t('upcoming.description')}
        highlighted={context.highlighted}
        icon={Clock01Icon}
        renderItem={renderItem}
        title={t('upcoming.title')}
      />
    </section>
  )
}
