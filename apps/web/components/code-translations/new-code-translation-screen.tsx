'use client'

import { Add01Icon, AiMagicIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import {
  hasValue,
  kindDirections,
  withEntry,
  withoutEntry,
} from '@/components/code-translations/lookup-table-entries'
import { namesFor, uniqueListName } from '@/components/code-translations/new-list-name'
import {
  AddValueForm,
  CodeInput,
  type MeaningOf,
  SentAs,
  type Sides,
  useValidation,
  ValueRow,
} from '@/components/code-translations/value-row'
import { LoadError } from '@/components/load-error'
import { scopeInputOf, scopeKey } from '@/components/lookup-tables/lookup-table-scope'
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
  type Direction,
  type LookupTableEntry,
  type LookupTableKind,
  lookupTableKinds,
  type LookupTableScopeInput,
  type LookupTableSuggestionsQuery,
  type SuggestedEntry,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { ScopeKind } from '@/components/lookup-tables/lookup-table-form-values'

const scopeKinds = ['workspace', 'tradingPartner'] as const satisfies ReadonlyArray<ScopeKind>

type AddRow =
  | { status: 'initial' }
  | { status: 'closed' }
  | { status: 'open'; key: number; focus: boolean }

function suggestionsQueryOf(
  kind: LookupTableKind,
  scope: LookupTableScopeInput,
): LookupTableSuggestionsQuery {
  return scope.kind === 'tradingPartner'
    ? { kind, tradingPartnerId: scope.tradingPartnerId }
    : { kind }
}

function useKindSides(kind: LookupTableKind, direction: Direction): Sides {
  const t = useTranslations('CodeTranslationNew.sides')
  const yours = t(`${kind}.yours`)
  const partner = t(`${kind}.partner`)

  return direction === 'inbound'
    ? { source: partner, target: yours }
    : { source: yours, target: partner }
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
  direction,
  entries,
  onAccept,
  onSkip,
}: {
  suggestion: SuggestedEntry
  direction: Direction
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
    <li className="flex flex-col gap-1 py-3" data-code={sourceCode}>
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
          label={t('sendAs', { code: sourceCode, direction })}
          labelVisible={false}
          problem={messages.targetCode}
          value={targetCode}
          onCancel={() => setTargetCode(suggestion.targetCode)}
          onChange={setTargetCode}
        />
        <span className="flex gap-1">
          <Button
            size="sm"
            type="submit"
            aria-label={t('accept', { code: sourceCode })}
            className="focus-visible:ring-primary focus-visible:ring-offset-card focus-visible:ring-2 focus-visible:ring-offset-2">
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
  direction,
  suggestedCount,
  pending,
  skippedCount,
  restoredCode,
  entries,
  onAccept,
  onSkip,
  onShowSkipped,
}: {
  query: { isPending: boolean; isError: boolean; onRetry: () => void }
  direction: Direction
  suggestedCount: number
  pending: ReadonlyArray<SuggestedEntry>
  skippedCount: number
  restoredCode: string | null
  entries: ReadonlyArray<LookupTableEntry>
  onAccept: (entry: LookupTableEntry, index: number, list: HTMLElement | null) => void
  onSkip: (sourceCode: string, index: number, list: HTMLElement | null) => void
  onShowSkipped: () => void
}) {
  const t = useTranslations('CodeTranslationNew.suggestions')
  const headingId = useId()
  const list = useRef<HTMLUListElement>(null)

  function showSkipped() {
    flushSync(onShowSkipped)

    if (restoredCode !== null) {
      list.current
        ?.querySelector<HTMLElement>(`:scope > li[data-code="${CSS.escape(restoredCode)}"] input`)
        ?.focus()
    }
  }

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
      return <p className="text-muted-foreground text-sm">{t('done')}</p>
    }

    return (
      <ul
        ref={list}
        aria-labelledby={headingId}
        className="bg-card divide-y rounded-xl border px-3">
        {pending.map((suggestion, index) => (
          <SuggestionRow
            key={suggestion.sourceCode}
            direction={direction}
            entries={entries}
            suggestion={suggestion}
            onAccept={(entry) => onAccept(entry, index, list.current)}
            onSkip={() => onSkip(suggestion.sourceCode, index, list.current)}
          />
        ))}
      </ul>
    )
  }

  if (!query.isPending && !query.isError && suggestedCount === 0) {
    return <p className="text-muted-foreground text-sm">{t('none')}</p>
  }

  return (
    <section
      aria-busy={query.isPending || undefined}
      aria-labelledby={headingId}
      className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          {t('title')}
          {!query.isPending && !query.isError && pending.length > 0 && (
            <Badge variant="secondary">{pending.length}</Badge>
          )}
        </h2>
        <p className="text-primary flex items-center gap-1.5 text-xs font-medium">
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} aria-hidden className="size-4" />
          {t('byAi')}
        </p>
        <p className="text-muted-foreground text-sm">{t('description', { direction })}</p>
      </div>
      <p aria-live="polite" className="sr-only">
        {query.isPending && !query.isError ? t('loading') : ''}
      </p>
      {content()}
      {skippedCount > 0 && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
          {t('skippedCount', { count: skippedCount })}
          <Button size="sm" variant="link" className="h-auto px-0" onClick={showSkipped}>
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
  name,
  baseName,
}: {
  kind: LookupTableKind
  scope: LookupTableScopeInput
  name: string
  baseName: string
}) {
  const t = useTranslations('CodeTranslationNew')
  const tValues = useTranslations('CodeTranslation.values')
  const queryClient = useQueryClient()
  const router = useRouter()
  const direction = kindDirections[kind]
  const sides = useKindSides(kind, direction)
  const suggestions = useQuery(lookupTableSuggestionsQuery(suggestionsQueryOf(kind, scope)))
  const valuesId = useId()
  const valuesHeading = useRef<HTMLHeadingElement>(null)
  const valuesList = useRef<HTMLUListElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [entries, setEntries] = useState<LookupTableEntry[]>([])
  const [skipped, setSkipped] = useState<ReadonlyArray<string>>([])
  const nextAddKey = useRef(1)
  const [adding, setAdding] = useState<AddRow>({ status: 'initial' })
  const [announcement, setAnnouncement] = useState('')
  const suggested = suggestions.data?.entries ?? []
  const noSuggestions = suggestions.isSuccess && suggested.length === 0

  const pending = suggested.filter(
    ({ sourceCode }) => !hasValue(entries, sourceCode) && !skipped.includes(sourceCode),
  )

  const restoredCode =
    suggested.find(
      ({ sourceCode }) => skipped.includes(sourceCode) && !hasValue(entries, sourceCode),
    )?.sourceCode ?? null

  const initialAddRow: AddRow = noSuggestions
    ? { status: 'open', key: 0, focus: false }
    : { status: 'closed' }

  const addRow = adding.status === 'initial' ? initialAddRow : adding

  const meanings = new Map(
    suggested.flatMap(({ targetCode, targetMeaning }) =>
      targetMeaning === null ? [] : [[targetCode, targetMeaning] as const],
    ),
  )

  const meaningOf: MeaningOf = (code) => meanings.get(code) ?? null

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

  function openAddRow() {
    setAdding({ status: 'open', key: nextAddKey.current++, focus: true })
  }

  function addEntry(entry: LookupTableEntry) {
    setEntries((current) => [...current, entry])
    setAnnouncement(t('values.added', { code: entry.sourceCode }))
  }

  function focusNextSuggestion(list: HTMLElement | null, index: number) {
    if (!focusInRow(list, index, 'input')) {
      valuesHeading.current?.focus()
    }
  }

  function accept(entry: LookupTableEntry, index: number, list: HTMLElement | null) {
    flushSync(() => addEntry(entry))
    focusNextSuggestion(list, index)
  }

  function skip(sourceCode: string, index: number, list: HTMLElement | null) {
    flushSync(() => {
      setSkipped((current) => [...current, sourceCode])
      setAnnouncement(t('suggestions.skipped', { code: sourceCode }))
    })
    focusNextSuggestion(list, index)
  }

  function cancelAdding() {
    flushSync(() => setAdding({ status: 'closed' }))
    addButton.current?.focus()
  }

  function edit(index: number, edited: LookupTableEntry, done: () => void) {
    flushSync(() => {
      setEntries((current) => withEntry(current, edited, index))
      done()
    })
    focusInRow(valuesList.current, index, 'button')
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
        direction={direction}
        entries={entries}
        pending={pending}
        query={{
          isPending: suggestions.isPending,
          isError: suggestions.isError,
          onRetry: () => void suggestions.refetch(),
        }}
        restoredCode={restoredCode}
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
            className="focus-visible:ring-primary focus-visible:ring-offset-background rounded-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
            {t('values.title')}{' '}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({entries.length})
            </span>
          </h2>
          {addRow.status === 'closed' && (
            <Button ref={addButton} variant="outline" onClick={openAddRow}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
              {tValues('add')}
            </Button>
          )}
        </div>
        {addRow.status === 'open' && (
          <AddValueForm
            key={addRow.key}
            direction={direction}
            entries={entries}
            focusOnOpen={addRow.focus}
            initial={{ key: addRow.key, sourceCode: '' }}
            meaningOf={meaningOf}
            saving={false}
            sides={sides}
            suggestionsOf={() => []}
            onAdd={(entry) => {
              addEntry(entry)
              openAddRow()
            }}
            onCancel={cancelAdding}
          />
        )}
        {entries.length > 0 && (
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
                sides={sides}
                onRemove={() => remove(index)}
                onSave={(edited, done) => edit(index, edited, done)}
              />
            ))}
          </ul>
        )}
        {entries.length === 0 && !noSuggestions && (
          <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm">
            {t('values.empty')}
          </p>
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
  const tables = useQuery(lookupTablesQuery)
  const kindHeading = useId()
  const scopeHeading = useId()
  const tradingPartnerField = useId()
  const [kind, setKind] = useState<LookupTableKind | null>(null)
  const [scopeKind, setScopeKind] = useState<ScopeKind | null>(null)
  const [tradingPartnerId, setTradingPartnerId] = useState<string | null>(null)
  const scope = scopeKind === null ? null : scopeInputOf(scopeKind, tradingPartnerId)

  const partner =
    scope?.kind === 'tradingPartner'
      ? tradingPartners.data?.find(({ id }) => id === scope.tradingPartnerId)
      : undefined

  function baseNameOf(chosenKind: LookupTableKind) {
    return partner
      ? t('name.tradingPartner', { kind: tKinds(chosenKind), partner: partner.name })
      : tKinds(chosenKind)
  }

  const chosen =
    kind && scope
      ? {
          kind,
          scope,
          baseName: baseNameOf(kind),
          name: uniqueListName(baseNameOf(kind), namesFor(tables.data ?? [], scope)),
        }
      : null

  return (
    <AppPage title={chosen ? t('titleNamed', { name: chosen.name }) : t('title')}>
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
          <section aria-labelledby={scopeHeading} className="flex flex-col gap-3">
            <h2 id={scopeHeading} className="text-base font-semibold">
              {t('receiver.question', { direction: kindDirections[kind] })}
            </h2>
            <ChoiceCards
              items={scopeKinds.map((value) => ({
                value,
                title: t(`receiver.${value}.title`),
                description: t(`receiver.${value}.description`, {
                  direction: kindDirections[kind],
                }),
              }))}
              labelledBy={scopeHeading}
              value={scopeKind}
              onChange={setScopeKind}
            />
            {scopeKind === 'tradingPartner' && (
              <TradingPartnerChoice
                id={tradingPartnerField}
                error={null}
                value={tradingPartnerId}
                onChange={setTradingPartnerId}
              />
            )}
          </section>
        )}
        {chosen && (
          <FirstValues
            key={`${chosen.kind}-${scopeKey(chosen.scope)}`}
            baseName={chosen.baseName}
            kind={chosen.kind}
            name={chosen.name}
            scope={chosen.scope}
          />
        )}
      </div>
    </AppPage>
  )
}
