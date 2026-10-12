'use client'

import { ArrowRight02Icon, Delete02Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useRef, useState } from 'react'

import {
  type EntryProblem,
  type EntryProblems,
  problemsOf,
  trimmedEntry,
} from '@/components/code-translations/lookup-table-entries'
import {
  type CodeMeaning,
  type Direction,
  type LookupTableEntry,
  maxLookupCodeLength,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Input } from '@edi-bridge/ui/components/input'
import { cn } from '@edi-bridge/ui/lib/utils'

export type MeaningOf = (code: string) => string | null

export function focusOnMount(element: HTMLElement | null) {
  element?.focus()
}

export function revealOnMount(row: HTMLElement | null) {
  row?.scrollIntoView({ block: 'center' })
}

function useProblemMessage() {
  const t = useTranslations('CodeTranslation.values.errors')

  return (problem: EntryProblem, code: string) => {
    switch (problem) {
      case 'required':
        return t('required')
      case 'tooLong':
        return t('tooLong', { max: maxLookupCodeLength })
      case 'duplicate':
        return t('duplicate', { code })
    }
  }
}

export function SentAs({ direction }: { direction: Direction }) {
  const t = useTranslations('CodeTranslation.values')

  return (
    <>
      <HugeiconsIcon
        icon={ArrowRight02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <span className="sr-only"> {t('arrow', { direction })} </span>
    </>
  )
}

function CodeInput({
  label,
  labelVisible,
  value,
  problem,
  focusFirst,
  onChange,
  onCancel,
}: {
  label: string
  labelVisible: boolean
  value: string
  problem: string | null
  focusFirst: boolean
  onChange: (value: string) => void
  onCancel: () => void
}) {
  const id = useId()

  return (
    <div className="flex min-w-24 flex-1 flex-col gap-1">
      <label htmlFor={id} className={labelVisible ? 'text-sm font-medium' : 'sr-only'}>
        {label}
      </label>
      <Input
        id={id}
        autoComplete="off"
        ref={focusFirst ? focusOnMount : undefined}
        spellCheck={false}
        value={value}
        aria-describedby={problem ? `${id}-problem` : undefined}
        aria-invalid={problem ? true : undefined}
        className="font-mono"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      {problem && (
        <p id={`${id}-problem`} className="text-destructive-text text-xs">
          {problem}
        </p>
      )}
    </div>
  )
}

export function useValidation(entries: ReadonlyArray<LookupTableEntry>, index: number | null) {
  const [attempted, setAttempted] = useState(false)
  const problemMessage = useProblemMessage()

  return {
    messagesFor(entry: LookupTableEntry) {
      const problems: EntryProblems | null = attempted ? problemsOf(entries, entry, index) : null

      const messageOf = (problem: EntryProblem | null | undefined) =>
        problem ? problemMessage(problem, entry.sourceCode.trim()) : null

      return {
        sourceCode: messageOf(problems?.sourceCode),
        targetCode: messageOf(problems?.targetCode),
      }
    },
    submit(event: FormEvent, entry: LookupTableEntry, onValid: (entry: LookupTableEntry) => void) {
      event.preventDefault()
      setAttempted(true)

      if (problemsOf(entries, entry, index) === null) {
        onValid(trimmedEntry(entry))
      }
    },
  }
}

export function ValueRow({
  entry,
  direction,
  index,
  entries,
  meaningOf,
  highlighted,
  focusRequest,
  canChange,
  saving,
  onSave,
  onRemove,
}: {
  entry: LookupTableEntry
  direction: Direction
  index: number
  entries: ReadonlyArray<LookupTableEntry>
  meaningOf: MeaningOf
  highlighted: boolean
  focusRequest: number | null
  canChange: boolean
  saving: boolean
  onSave: (entry: LookupTableEntry, done: () => void) => void
  onRemove: () => void
}) {
  const t = useTranslations('CodeTranslation.values')
  const [editing, setEditing] = useState(false)
  const returnFocus = useRef(false)
  const handledFocusRequest = useRef<number | null>(null)
  const meaning = meaningOf(entry.targetCode)

  function stopEditing() {
    returnFocus.current = true
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="bg-muted/50 rounded-lg p-2">
        <EditValueForm
          direction={direction}
          entries={entries}
          entry={entry}
          index={index}
          saving={saving}
          onCancel={stopEditing}
          onSave={(edited) => onSave(edited, stopEditing)}
        />
      </li>
    )
  }

  return (
    <li
      ref={highlighted ? revealOnMount : undefined}
      className={cn(
        'grid scroll-mt-20 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2',
        highlighted && 'ring-primary ring-2',
      )}>
      <span className="truncate font-mono sm:text-base">{entry.sourceCode}</span>
      <SentAs direction={direction} />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="truncate font-mono font-medium sm:text-base">{entry.targetCode}</span>
        {meaning && <span className="text-muted-foreground truncate text-xs">{meaning}</span>}
      </span>
      {canChange ? (
        <span className="flex gap-0.5">
          <Button
            disabled={saving}
            ref={(button) => {
              const requested =
                focusRequest !== null && handledFocusRequest.current !== focusRequest

              if (button && (returnFocus.current || requested)) {
                returnFocus.current = false
                handledFocusRequest.current = focusRequest
                button.focus()
              }
            }}
            size="icon-sm"
            variant="ghost"
            aria-label={t('edit', { code: entry.sourceCode })}
            onClick={() => setEditing(true)}>
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} aria-hidden />
          </Button>
          <Button
            disabled={saving}
            size="icon-sm"
            variant="ghost"
            aria-label={t('remove', { code: entry.sourceCode })}
            onClick={onRemove}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden />
          </Button>
        </span>
      ) : (
        <span />
      )}
    </li>
  )
}

function EditValueForm({
  entry,
  direction,
  index,
  entries,
  saving,
  onSave,
  onCancel,
}: {
  entry: LookupTableEntry
  direction: Direction
  index: number
  entries: ReadonlyArray<LookupTableEntry>
  saving: boolean
  onSave: (entry: LookupTableEntry) => void
  onCancel: () => void
}) {
  const t = useTranslations('CodeTranslation.values')
  const [draft, setDraft] = useState(entry)
  const validation = useValidation(entries, index)
  const messages = validation.messagesFor(draft)

  return (
    <form
      noValidate
      aria-label={t('editing', { code: entry.sourceCode })}
      className="flex flex-wrap items-start gap-2"
      onSubmit={(event) => validation.submit(event, draft, onSave)}>
      <CodeInput
        focusFirst
        label={t('source', { direction })}
        labelVisible={false}
        problem={messages.sourceCode}
        value={draft.sourceCode}
        onCancel={onCancel}
        onChange={(sourceCode) => setDraft({ ...draft, sourceCode })}
      />
      <span className="flex h-8 items-center">
        <SentAs direction={direction} />
      </span>
      <CodeInput
        focusFirst={false}
        label={t('target', { direction })}
        labelVisible={false}
        problem={messages.targetCode}
        value={draft.targetCode}
        onCancel={onCancel}
        onChange={(targetCode) => setDraft({ ...draft, targetCode })}
      />
      <span className="flex gap-1">
        <Button disabled={saving} size="sm" type="submit">
          {saving ? t('saving') : t('save')}
        </Button>
        <Button disabled={saving} size="sm" type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </span>
    </form>
  )
}

export type AddDraft = { key: number; sourceCode: string }

export function AddValueForm({
  initial,
  direction,
  entries,
  suggestionsOf,
  meaningOf,
  saving,
  onAdd,
  onCancel,
}: {
  initial: AddDraft
  direction: Direction
  entries: ReadonlyArray<LookupTableEntry>
  suggestionsOf: (sourceCode: string) => ReadonlyArray<CodeMeaning>
  meaningOf: MeaningOf
  saving: boolean
  onAdd: (entry: LookupTableEntry) => void
  onCancel: () => void
}) {
  const t = useTranslations('CodeTranslation.values')
  const suggestionsLabel = useId()
  const [chosenTarget, setChosenTarget] = useState<string | null>(null)

  const [sourceCode, setSourceCode] = useState(initial.sourceCode)
  const validation = useValidation(entries, null)
  const suggestions = suggestionsOf(sourceCode.trim())
  const targetCode = chosenTarget ?? suggestions[0]?.code ?? ''
  const messages = validation.messagesFor({ sourceCode, targetCode })
  const meaning = targetCode.trim() === '' ? null : meaningOf(targetCode.trim())

  return (
    <form
      noValidate
      aria-label={t('add')}
      className="flex flex-col gap-3 rounded-xl border border-dashed p-3"
      onSubmit={(event) => validation.submit(event, { sourceCode, targetCode }, onAdd)}>
      <div className="flex flex-wrap items-start gap-2">
        <CodeInput
          focusFirst={initial.sourceCode === ''}
          label={t('source', { direction })}
          labelVisible
          problem={messages.sourceCode}
          value={sourceCode}
          onCancel={onCancel}
          onChange={setSourceCode}
        />
        <span className="flex h-8 items-center self-end">
          <SentAs direction={direction} />
        </span>
        <CodeInput
          focusFirst={initial.sourceCode !== ''}
          label={t('target', { direction })}
          labelVisible
          problem={messages.targetCode}
          value={targetCode}
          onCancel={onCancel}
          onChange={setChosenTarget}
        />
      </div>
      {meaning && (
        <p className="text-muted-foreground text-xs">
          {t('meaning', { code: targetCode.trim(), meaning })}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span id={suggestionsLabel} className="text-muted-foreground">
            {t('suggestions')}
          </span>
          <div role="group" aria-labelledby={suggestionsLabel} className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.code}
                size="sm"
                type="button"
                variant={suggestion.code === targetCode ? 'secondary' : 'outline'}
                aria-pressed={suggestion.code === targetCode}
                onClick={() => setChosenTarget(suggestion.code)}>
                <span className="font-mono">{suggestion.code}</span>
                <span className="text-xs">{suggestion.meaning}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={saving} size="sm" type="submit">
          {saving ? t('saving') : t('save')}
        </Button>
        <Button disabled={saving} size="sm" type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}
