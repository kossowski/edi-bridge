'use client'

import { Add01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import {
  hasValue,
  withEntry,
  withoutEntry,
} from '@/components/code-translations/lookup-table-entries'
import { namesFor, uniqueListName } from '@/components/code-translations/new-list-name'
import {
  CodeInput,
  type MeaningOf,
  SentAs,
  useValidation,
  ValueRow,
  AddValueForm,
} from '@/components/code-translations/value-row'
import { LoadError } from '@/components/load-error'
import { scopeKey } from '@/components/lookup-tables/lookup-table-scope'
import { TradingPartnerChoice } from '@/components/lookup-tables/trading-partner-choice'
import { ChoiceCards } from '@/components/trading-partners/choice-cards'
import { createLookupTable } from '@/lib/api/client'
import {
  lookupTableSuggestionsQuery,
  lookupTablesQuery,
  storeSavedLookupTable,
  tradingPartnersQuery,
} from '@/lib/api/queries'
import { lookupTableHref } from '@/lib/navigation'
import {
  type LookupTableEntry,
  type LookupTableKind,
  lookupTableKinds,
  type LookupTableScopeInput,
  type LookupTableSuggestionsQuery,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { ScopeKind } from '@/components/lookup-tables/lookup-table-form-values'

type Suggestion = LookupTableEntry & { targetMeaning: string | null }

const receivers = ['workspace', 'tradingPartner'] as const satisfies ReadonlyArray<ScopeKind>

const direction = 'outbound'

function scopeOf(receiver: ScopeKind | null, tradingPartnerId: string | null) {
  if (receiver === 'workspace') {
    return { kind: 'workspace' } satisfies LookupTableScopeInput
  }

  return receiver === 'tradingPartner' && tradingPartnerId !== null
    ? ({ kind: 'tradingPartner', tradingPartnerId } satisfies LookupTableScopeInput)
    : null
}

function suggestionsQueryOf(
  kind: LookupTableKind,
  scope: LookupTableScopeInput,
): LookupTableSuggestionsQuery {
  return scope.kind === 'tradingPartner'
    ? { kind, tradingPartnerId: scope.tradingPartnerId }
    : { kind }
}

function focusInRow(list: HTMLElement | null, index: number, selector: string) {
  if (!list?.isConnected) {
    return false
  }

  const rows = list.querySelectorAll(':scope > li')
  const element = rows[Math.min(index, rows.length - 1)]?.querySelector<HTMLElement>(selector)

  element?.focus()

  return element !== null && element !== undefined
}

function SuggestionRow({
  suggestion,
  entries,
  onAccept,
  onSkip,
}: {
  suggestion: Suggestion
  entries: ReadonlyArray<LookupTableEntry>
  onAccept: (entry: LookupTableEntry) => void
  onSkip: () => void
}) {
  const t = useTranslations('CodeTranslationNew.suggestions')
  const tValues = useTranslations('CodeTranslation.values')
  const [targetCode, setTargetCode] = useState(suggestion.targetCode)
  const validation = useValidation(entries, null)
  const { sourceCode } = suggestion
  const messages = validation.messagesFor({ sourceCode, targetCode })
  const meaning = targetCode.trim() === suggestion.targetCode ? suggestion.targetMeaning : null

  return (
    <li className="flex flex-col gap-1 py-3">
      <form
        noValidate
        aria-label={t('row', { code: sourceCode })}
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => validation.submit(event, { sourceCode, targetCode }, onAccept)}>
        <span className="flex h-8 min-w-16 items-center font-mono sm:text-base">{sourceCode}</span>
        <span className="flex h-8 items-center">
          <SentAs direction={direction} />
        </span>
        <CodeInput
          focusFirst={false}
          label={t('sendAs', { code: sourceCode })}
          labelVisible={false}
          problem={messages.targetCode}
          value={targetCode}
          onCancel={() => setTargetCode(suggestion.targetCode)}
          onChange={setTargetCode}
        />
        <span className="flex gap-1">
          <Button size="sm" type="submit" aria-label={t('accept', { code: sourceCode })}>
            {t('acceptShort')}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            aria-label={t('skip', { code: sourceCode })}
            onClick={onSkip}>
            {t('skipShort')}
          </Button>
        </span>
      </form>
      {meaning && (
        <p className="text-muted-foreground text-xs">
          {tValues('meaning', { code: suggestion.targetCode, meaning })}
        </p>
      )}
    </li>
  )
}

function LoadingSuggestions() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-10 rounded-lg" />
      ))}
    </div>
  )
}

function Suggestions({
  query,
  suggestedCount,
  pending,
  skippedCount,
  entries,
  onAccept,
  onSkip,
  onShowSkipped,
}: {
  query: { isPending: boolean; isError: boolean; onRetry: () => void }
  suggestedCount: number
  pending: ReadonlyArray<Suggestion>
  skippedCount: number
  entries: ReadonlyArray<LookupTableEntry>
  onAccept: (entry: LookupTableEntry, index: number, list: HTMLElement | null) => void
  onSkip: (sourceCode: string, index: number, list: HTMLElement | null) => void
  onShowSkipped: () => void
}) {
  const t = useTranslations('CodeTranslationNew.suggestions')
  const headingId = useId()
  const list = useRef<HTMLUListElement>(null)

  function content() {
    if (query.isError) {
      return (
        <LoadError
          description={t('error.description')}
          retryLabel={t('error.retry')}
          title={t('error.title')}
          onRetry={query.onRetry}
        />
      )
    }

    if (query.isPending) {
      return <LoadingSuggestions />
    }

    if (pending.length === 0) {
      return (
        <p className="text-muted-foreground text-sm">
          {suggestedCount === 0 ? t('none') : t('done')}
        </p>
      )
    }

    return (
      <ul
        ref={list}
        aria-labelledby={headingId}
        className="bg-card divide-y rounded-xl border px-3">
        {pending.map((suggestion, index) => (
          <SuggestionRow
            key={suggestion.sourceCode}
            entries={entries}
            suggestion={suggestion}
            onAccept={(entry) => onAccept(entry, index, list.current)}
            onSkip={() => onSkip(suggestion.sourceCode, index, list.current)}
          />
        ))}
      </ul>
    )
  }

  return (
    <section
      aria-busy={query.isPending || undefined}
      aria-labelledby={headingId}
      className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          {t('title')}
          {!query.isPending && !query.isError && pending.length > 0 && (
            <Badge variant="secondary">{pending.length}</Badge>
          )}
        </h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      <p aria-live="polite" className="sr-only">
        {query.isPending && !query.isError ? t('loading') : ''}
      </p>
      {content()}
      {skippedCount > 0 && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          {t('skippedCount', { count: skippedCount })}
          <Button size="sm" variant="link" className="h-auto px-0" onClick={onShowSkipped}>
            {t('showSkipped')}
          </Button>
        </p>
      )}
    </section>
  )
}

function FirstValues({
  kind,
  scope,
  baseName,
}: {
  kind: LookupTableKind
  scope: LookupTableScopeInput
  baseName: string
}) {
  const t = useTranslations('CodeTranslationNew')
  const tValues = useTranslations('CodeTranslation.values')
  const queryClient = useQueryClient()
  const router = useRouter()
  const suggestions = useQuery(lookupTableSuggestionsQuery(suggestionsQueryOf(kind, scope)))
  const tables = useQuery(lookupTablesQuery)
  const valuesId = useId()
  const valuesHeading = useRef<HTMLHeadingElement>(null)
  const valuesList = useRef<HTMLUListElement>(null)
  const [entries, setEntries] = useState<LookupTableEntry[]>([])
  const [skipped, setSkipped] = useState<ReadonlyArray<string>>([])
  const nextAddKey = useRef(1)
  const [adding, setAdding] = useState<{ key: number; focus: boolean } | null | undefined>()
  const [announcement, setAnnouncement] = useState('')
  const suggested = suggestions.data?.entries ?? []

  const pending = suggested.filter(
    ({ sourceCode }) => !hasValue(entries, sourceCode) && !skipped.includes(sourceCode),
  )

  const addForm =
    adding === undefined && suggestions.data?.entries.length === 0
      ? { key: 0, focus: false }
      : (adding ?? null)

  const meanings = new Map(
    suggested.flatMap(({ targetCode, targetMeaning }) =>
      targetMeaning === null ? [] : [[targetCode, targetMeaning] as const],
    ),
  )

  const meaningOf: MeaningOf = (code) => meanings.get(code) ?? null
  const name = uniqueListName(baseName, namesFor(tables.data ?? [], scope))

  const create = useMutation({
    mutationFn: async () => {
      const latest = await queryClient.fetchQuery({ ...lookupTablesQuery, staleTime: 0 })

      return createLookupTable({
        name: uniqueListName(baseName, namesFor(latest, scope)),
        kind,
        scope,
        entries,
      })
    },
    onSuccess: (saved) => {
      storeSavedLookupTable(queryClient, saved)
      router.push(lookupTableHref(saved.id))
    },
  })

  function focusNextSuggestion(list: HTMLElement | null, index: number) {
    if (!focusInRow(list, index, 'input')) {
      valuesHeading.current?.focus()
    }
  }

  function accept(entry: LookupTableEntry, index: number, list: HTMLElement | null) {
    flushSync(() => {
      setEntries((current) => [...current, entry])
      setAnnouncement(t('values.added', { code: entry.sourceCode }))
    })
    focusNextSuggestion(list, index)
  }

  function skip(sourceCode: string, index: number, list: HTMLElement | null) {
    flushSync(() => {
      setSkipped((current) => [...current, sourceCode])
      setAnnouncement(t('suggestions.skipped', { code: sourceCode }))
    })
    focusNextSuggestion(list, index)
  }

  function remove(index: number) {
    const entry = entries[index]

    flushSync(() => {
      setEntries((current) => withoutEntry(current, index))
      setAnnouncement(entry ? t('values.removed', { code: entry.sourceCode }) : '')
    })

    if (!focusInRow(valuesList.current, index, 'button')) {
      valuesHeading.current?.focus()
    }
  }

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Suggestions
        entries={entries}
        pending={pending}
        query={{
          isPending: suggestions.isPending,
          isError: suggestions.isError,
          onRetry: () => void suggestions.refetch(),
        }}
        skippedCount={skipped.length}
        suggestedCount={suggested.length}
        onAccept={accept}
        onShowSkipped={() => setSkipped([])}
        onSkip={skip}
      />
      <section aria-labelledby={valuesId} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id={valuesId}
            ref={valuesHeading}
            tabIndex={-1}
            className="text-base font-semibold outline-none">
            {t('values.title')}{' '}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({entries.length})
            </span>
          </h2>
          {addForm === null && (
            <Button
              variant="outline"
              onClick={() => setAdding({ key: nextAddKey.current++, focus: true })}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
              {tValues('add')}
            </Button>
          )}
        </div>
        {addForm && (
          <AddValueForm
            key={addForm.key}
            direction={direction}
            entries={entries}
            focusOnOpen={addForm.focus}
            initial={{ key: addForm.key, sourceCode: '' }}
            meaningOf={meaningOf}
            saving={false}
            suggestionsOf={() => []}
            onAdd={(entry) => {
              setEntries((current) => [...current, entry])
              setAnnouncement(t('values.added', { code: entry.sourceCode }))
              setAdding({ key: nextAddKey.current++, focus: true })
            }}
            onCancel={() => setAdding(null)}
          />
        )}
        {entries.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm">
            {t('values.empty')}
          </p>
        ) : (
          <ul
            ref={valuesList}
            aria-labelledby={valuesId}
            className="bg-card divide-y rounded-xl border px-2">
            {entries.map((entry, index) => (
              <ValueRow
                key={entry.sourceCode}
                canChange
                direction={direction}
                entries={entries}
                entry={entry}
                focusRequest={null}
                highlighted={false}
                index={index}
                meaningOf={meaningOf}
                saving={false}
                onRemove={() => remove(index)}
                onSave={(edited, done) => {
                  setEntries((current) => withEntry(current, edited, index))
                  done()
                }}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4">
        <p className="text-sm">
          {t.rich('create.summary', {
            count: entries.length,
            name,
            strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
          })}
        </p>
        {pending.length > 0 && (
          <p className="text-muted-foreground text-sm">
            {t('create.pendingLeftOut', { count: pending.length })}
          </p>
        )}
        {create.isError && (
          <p role="alert" className="text-destructive-text text-sm">
            {t('create.failed')}
          </p>
        )}
        <Button disabled={create.isPending} className="w-fit" onClick={() => create.mutate()}>
          {create.isPending ? t('create.creating') : t('create.submit')}
        </Button>
      </section>
    </>
  )
}

export function NewCodeTranslationScreen() {
  const t = useTranslations('CodeTranslationNew')
  const tKinds = useTranslations('CodeTranslations.kinds')
  const tradingPartners = useQuery(tradingPartnersQuery)
  const kindHeading = useId()
  const receiverHeading = useId()
  const tradingPartnerField = useId()
  const [kind, setKind] = useState<LookupTableKind | null>(null)
  const [receiver, setReceiver] = useState<ScopeKind | null>(null)
  const [tradingPartnerId, setTradingPartnerId] = useState<string | null>(null)
  const scope = scopeOf(receiver, tradingPartnerId)

  const partner =
    scope?.kind === 'tradingPartner'
      ? tradingPartners.data?.find(({ id }) => id === scope.tradingPartnerId)
      : undefined

  function baseNameOf(chosen: LookupTableKind) {
    return partner
      ? t('name.tradingPartner', { kind: tKinds(chosen), partner: partner.name })
      : tKinds(chosen)
  }

  return (
    <AppPage title={t('title')}>
      <p className="text-muted-foreground max-w-prose text-sm">{t('intro')}</p>
      <div className="flex max-w-3xl flex-col gap-8">
        <section aria-labelledby={kindHeading} className="flex flex-col gap-3">
          <h2 id={kindHeading} className="text-base font-semibold">
            {t('kind.question')}
          </h2>
          <ChoiceCards
            items={lookupTableKinds.map((value) => ({
              value,
              title: tKinds(value),
              description: t(`kind.examples.${value}`),
            }))}
            labelledBy={kindHeading}
            value={kind}
            onChange={setKind}
          />
        </section>
        {kind && (
          <section aria-labelledby={receiverHeading} className="flex flex-col gap-3">
            <h2 id={receiverHeading} className="text-base font-semibold">
              {t('receiver.question')}
            </h2>
            <ChoiceCards
              items={receivers.map((value) => ({
                value,
                title: t(`receiver.${value}.title`),
                description: t(`receiver.${value}.description`),
              }))}
              labelledBy={receiverHeading}
              value={receiver}
              onChange={setReceiver}
            />
            {receiver === 'tradingPartner' && (
              <TradingPartnerChoice
                id={tradingPartnerField}
                error={null}
                value={tradingPartnerId}
                onChange={setTradingPartnerId}
              />
            )}
          </section>
        )}
        {kind && scope && (
          <FirstValues
            key={`${kind}-${scopeKey(scope)}`}
            baseName={baseNameOf(kind)}
            kind={kind}
            scope={scope}
          />
        )}
      </div>
    </AppPage>
  )
}
