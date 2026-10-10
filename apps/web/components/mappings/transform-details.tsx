'use client'

import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { describedBy, TextField } from '@/components/form-field'
import { insertText, jsonataPath, textPosition } from '@/components/mappings/expression-text'
import { type CanvasIssue, linkIntoInput, type Graph } from '@/components/mappings/mapping-graph'
import { type FieldInput, formFields } from '@/components/mappings/transform-kinds'
import { lookupTablesQuery } from '@/lib/api/queries'
import {
  conditionOperators,
  decimalSeparators,
  draftTransformConfigSchemas,
  expressionSyntaxError,
  lookupFallbacks,
  operatorsWithOperand,
  transformConfigIssues,
  transformPorts,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Textarea } from '@edi-bridge/ui/components/textarea'

import type { GraphText } from '@/components/mappings/graph-text'
import type {
  ConditionOperator,
  LookupTableSummary,
  MappingTransform,
  TransformConfigIssue,
  TransformLink,
} from '@edi-bridge/contracts'

export type SourceField = { path: string; label: string }

type Values = Readonly<Record<string, string>>

type Candidate = Record<string, string | number | null>

function valuesOf(transform: MappingTransform): Values {
  // SAFETY: every config is a flat object of strings, numbers and nulls, keyed by its field names.
  const config = transform.config as Readonly<Record<string, string | number | null>>

  return Object.fromEntries(
    formFields(transform.kind).map(({ name }) => [name, String(config[name] ?? '')]),
  )
}

const wholeNumber = /^-?\d+$/

const numberInputs: ReadonlyArray<FieldInput> = ['integer', 'optionalInteger']

function read(kind: MappingTransform['kind'], values: Values) {
  const candidate: Candidate = {}
  const local: TransformConfigIssue[] = []

  for (const { name: field, input: type } of formFields(kind)) {
    const value = values[field] ?? ''

    if (type === 'lookupTable') {
      candidate[field] = value === '' ? null : value
    } else if (!numberInputs.includes(type)) {
      candidate[field] = value
    } else if (value.trim() === '') {
      candidate[field] = null

      if (type === 'integer') {
        local.push({ field, code: 'required' })
      }
    } else if (wholeNumber.test(value.trim())) {
      candidate[field] = Number(value.trim())
    } else {
      candidate[field] = value
      local.push({ field, code: 'invalid' })
    }
  }

  const fromSchema = transformConfigIssues({ kind, config: candidate }).filter(
    (issue) => !local.some(({ field }) => field === issue.field),
  )

  const saveable = draftTransformConfigSchemas[kind].safeParse(candidate)

  return {
    issues: [...local, ...fromSchema],
    config: saveable.success ? saveable.data : null,
  }
}

function sameValues(kind: MappingTransform['kind'], a: Values, b: Values) {
  return formFields(kind).every(({ name }) => a[name] === b[name])
}

function hasOperand(operator: string) {
  return operatorsWithOperand.some((candidate) => candidate === operator)
}

type ChoiceInput = Extract<FieldInput, 'decimalSeparator' | 'fallback' | 'operator'>

function isChoice(type: FieldInput): type is ChoiceInput {
  return type === 'decimalSeparator' || type === 'fallback' || type === 'operator'
}

function useChoices() {
  const t = useTranslations('Mapping.transforms')

  return (type: ChoiceInput): ReadonlyArray<{ value: string; label: string }> => {
    switch (type) {
      case 'decimalSeparator':
        return decimalSeparators.map((value) => ({
          value,
          label: t(value === '.' ? 'separators.point' : 'separators.comma'),
        }))
      case 'fallback':
        return lookupFallbacks.map((value) => ({ value, label: t(`fallbacks.${value}`) }))
      case 'operator':
        return conditionOperators.map((value: ConditionOperator) => ({
          value,
          label: t(`operatorNames.${value}`),
        }))
    }
  }
}

function ChoiceField({
  id,
  label,
  description,
  value,
  choices,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  choices: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        value={value}
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-2"
        onValueChange={(next) => onChange(String(next))}>
        {choices.map((choice) => (
          <label key={choice.value} className="flex min-h-6 items-center gap-2 text-sm">
            <RadioGroupItem value={choice.value} />
            {choice.label}
          </label>
        ))}
      </RadioGroup>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
    </div>
  )
}

function FieldError({ id, error }: { id: string; error: string | null }) {
  return (
    error && (
      <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
        {error}
      </p>
    )
  )
}

function useScopeText() {
  const t = useTranslations('Mapping.transforms.lookupTables')

  return ({ scope }: LookupTableSummary) =>
    scope.kind === 'workspace'
      ? t('workspace')
      : t('tradingPartner', { name: scope.tradingPartner.name })
}

function LookupTableField({
  id,
  label,
  description,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: string
  error: string | null
  onChange: (value: string) => void
}) {
  const t = useTranslations('Mapping.transforms.lookupTables')
  const scopeOf = useScopeText()
  const tables = useQuery(lookupTablesQuery)
  const items = (tables.data ?? []).map((table) => ({ value: table.id, label: table.name }))
  const chosen = tables.data?.find((table) => table.id === value)
  const loading = tables.isPending
  const unavailable = tables.isError || (tables.isSuccess && items.length === 0)
  const statusId = `${id}-status`

  const status = () => {
    if (loading) {
      return <p className="text-muted-foreground text-sm">{t('loading')}</p>
    }

    if (tables.isError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-red-800 dark:text-red-300">{t('error')}</p>
          <Button size="sm" variant="outline" onClick={() => void tables.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )
    }

    if (items.length === 0) {
      return <p className="text-muted-foreground text-sm">{t('empty')}</p>
    }

    return chosen ? <p className="text-sm">{t('scope', { scope: scopeOf(chosen) })}</p> : null
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <Select
        disabled={unavailable}
        items={items}
        // Until its items load, Base UI would show the raw value, an ID.
        value={chosen ? value : null}
        onOpenChange={(open, details) => {
          if (open && loading) {
            details.cancel()
          }
        }}
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        <SelectTrigger
          id={id}
          aria-busy={loading || undefined}
          aria-describedby={`${describedBy(id, error)} ${statusId}`}
          aria-disabled={loading || undefined}
          aria-invalid={error !== null}
          aria-labelledby={`${id}-label`}
          className="w-full aria-disabled:cursor-progress aria-disabled:opacity-50">
          <SelectValue placeholder={loading ? t('loading') : t('placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {(tables.data ?? []).map((table) => (
            <SelectItem key={table.id} label={table.name} value={table.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{table.name}</span>
                <span className="text-muted-foreground truncate text-xs">{scopeOf(table)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
      <div id={statusId} aria-live="polite">
        {status()}
      </div>
      <FieldError id={id} error={error} />
    </div>
  )
}

function ExpressionField({
  id,
  label,
  description,
  value,
  saved,
  required,
  sourceFields,
  onChange,
  onCommit,
}: {
  id: string
  label: string
  description: string
  value: string
  saved: string
  required: string | null
  sourceFields: ReadonlyArray<SourceField>
  onChange: (value: string) => void
  onCommit: (value: string) => void
}) {
  const t = useTranslations('Mapping.transforms.expression')
  const editor = useRef<HTMLTextAreaElement>(null)
  const selection = useRef<[number, number] | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const syntax = value.trim() === '' ? null : expressionSyntaxError(value)
  const at = syntax && textPosition(value, syntax.position)
  const pathItems = sourceFields.map((field) => ({ value: field.path, label: field.path }))

  const error = at
    ? t('syntaxError', { line: at.line, column: at.column, message: syntax.message })
    : required

  const remember = () => {
    const element = editor.current

    if (element) {
      selection.current = [element.selectionStart, element.selectionEnd]
    }
  }

  const focusAt = (offset: number) => {
    editor.current?.focus()
    editor.current?.setSelectionRange(offset, offset)
  }

  // An inserted path moves the caret once the editor holds the new text; a value written after the
  // caret would move it to the end.
  const pendingCaret = useRef<{ offset: number; value: string } | null>(null)

  useEffect(() => {
    const pending = pendingCaret.current

    if (pending?.value === value) {
      pendingCaret.current = null
      focusAt(pending.offset)
    }
  }, [value])

  const insert = () => {
    if (path === null) {
      return
    }

    const [start, end] = selection.current ?? [value.length, value.length]
    const next = insertText(value, start, end, jsonataPath(path))

    selection.current = [next.caret, next.caret]
    onChange(next.value)
    onCommit(next.value)
    pendingCaret.current = { offset: next.caret, value: next.value }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={id}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        ref={editor}
        rows={5}
        spellCheck={false}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        className="min-h-28 font-mono text-sm md:text-sm"
        onBlur={() => {
          remember()
          onCommit(value)
        }}
        onChange={(event) => onChange(event.target.value)}
        // Enter starts a new line here, so Ctrl+Enter or Cmd+Enter saves.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            onCommit(value)
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && value !== saved) {
            event.preventDefault()
            onChange(saved)
          }
        }}
        onSelect={remember}
      />
      <p id={`${id}-description`} className="text-muted-foreground text-sm">
        {description}
      </p>
      {error ? (
        <div className="flex flex-col items-start gap-2">
          <FieldError id={id} error={error} />
          {at && (
            <Button size="sm" variant="outline" onClick={() => focusAt(at.offset)}>
              {t('goToError')}
            </Button>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            aria-hidden
            className="size-4 shrink-0 text-green-700 dark:text-green-300"
          />
          {t('valid')}
        </p>
      )}
      <div className="flex flex-col gap-1.5 pt-1">
        <span id={`${id}-path-label`} className="text-sm font-medium">
          {t('sourcePath')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={pathItems.length === 0}
            items={pathItems}
            value={path}
            onValueChange={(next) =>
              setPath(pathItems.find((item) => item.value === next)?.value ?? null)
            }>
            <SelectTrigger
              aria-describedby={`${id}-path-description`}
              aria-labelledby={`${id}-path-label`}
              className="min-w-0 flex-1 font-mono">
              <SelectValue placeholder={t('sourcePathPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sourceFields.map((field) => (
                <SelectItem key={field.path} label={field.path} value={field.path}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-mono">{field.path}</span>
                    {field.label !== field.path && (
                      <span className="text-muted-foreground truncate text-xs">{field.label}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={path === null} size="sm" variant="outline" onClick={insert}>
            {t('insert')}
          </Button>
        </div>
        <p id={`${id}-path-description`} className="text-muted-foreground text-sm">
          {t('sourcePathDescription')}
        </p>
      </div>
    </div>
  )
}

function TransformSettings({
  transform,
  issues,
  sourceFields,
  text,
  onConfigure,
}: {
  transform: MappingTransform
  issues: ReadonlyArray<CanvasIssue>
  sourceFields: ReadonlyArray<SourceField>
  text: GraphText
  onConfigure: (config: MappingTransform['config']) => void
}) {
  const t = useTranslations('Mapping.transforms')
  const id = useId()
  const choices = useChoices()
  const saved = valuesOf(transform)
  const [base, setBase] = useState(saved)
  const [values, setValues] = useState(saved)

  // A save that failed puts the config back; the fields follow it, but not the server's echo of
  // what they already hold, so typing in progress is kept.
  if (!sameValues(transform.kind, base, saved)) {
    setBase(saved)
    setValues(saved)
  }

  const { issues: formIssues } = read(transform.kind, values)

  // A deleted Lookup Table is only known on the canvas; it stays a problem until another is chosen.
  const known = values.lookupTableId === saved.lookupTableId
  const unknownTable = known && issues.some(({ code }) => code === 'unknownLookupTable')

  const commit = (next: Values) => {
    const { config } = read(transform.kind, next)

    if (config && !sameValues(transform.kind, next, saved)) {
      setBase(next)
      onConfigure(config)
    }
  }

  const choose = (field: string, value: string) => {
    const next = { ...values, [field]: value }

    setValues(next)
    commit(next)
  }

  const errorOf = (field: string) => {
    if (field === 'lookupTableId' && unknownTable) {
      return t('issues.unknownLookupTable')
    }

    const issue = formIssues.find((found) => found.field === field)

    if (!issue) {
      return null
    }

    return issue.code === 'invalid' &&
      formFields(transform.kind).some(
        ({ name, input }) => name === field && numberInputs.includes(input),
      )
      ? t('issues.notWholeNumber', { field: text.field(transform.kind, field) })
      : text.issue(transform.kind, issue)
  }

  const shown = formFields(transform.kind).filter(
    ({ name }) => !(name === 'compareTo' && !hasOperand(values.operator ?? '')),
  )

  return (
    <div className="flex flex-col gap-4">
      {shown.map(({ name: field, input: type }) => {
        const fieldId = `${id}${field}`
        const label = text.field(transform.kind, field)
        // SAFETY: the form fields are exactly the keys under `fieldDescriptions.<kind>`.
        const description = t(`fieldDescriptions.${transform.kind}.${field}` as never)
        const value = values[field] ?? ''

        if (isChoice(type)) {
          return (
            <ChoiceField
              key={field}
              id={fieldId}
              choices={choices(type)}
              description={description}
              label={label}
              value={value}
              onChange={(next) => choose(field, next)}
            />
          )
        }

        if (type === 'lookupTable') {
          return (
            <LookupTableField
              key={field}
              id={fieldId}
              description={description}
              error={errorOf(field)}
              label={label}
              value={value}
              onChange={(next) => choose(field, next)}
            />
          )
        }

        if (type === 'expression') {
          return (
            <ExpressionField
              key={field}
              id={fieldId}
              description={description}
              label={label}
              required={value.trim() === '' ? errorOf(field) : null}
              saved={saved[field] ?? ''}
              sourceFields={sourceFields}
              value={value}
              onChange={(next) => setValues({ ...values, [field]: next })}
              onCommit={(next) => commit({ ...values, [field]: next })}
            />
          )
        }

        return (
          <TextField
            key={field}
            id={fieldId}
            autoComplete="off"
            description={description}
            error={errorOf(field)}
            inputMode={type === 'text' ? undefined : 'numeric'}
            label={label}
            spellCheck={false}
            value={value}
            className={type === 'text' ? 'font-mono sm:max-w-sm' : 'font-mono sm:w-28'}
            onBlur={() => commit(values)}
            onChange={(next) => setValues({ ...values, [field]: next })}
            // Enter saves, as leaving the field does.
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(values)
              }
            }}
            // The canvas clears the selection on Escape; caught before it, the first Escape only
            // takes back what was typed, so the form and the focus stay.
            onKeyDownCapture={(event) => {
              if (event.key === 'Escape' && values[field] !== saved[field]) {
                event.preventDefault()
                setValues({ ...values, [field]: saved[field] ?? '' })
              }
            }}
          />
        )
      })}
    </div>
  )
}

export type TransformDetailsActions = {
  configure: (transform: MappingTransform, config: MappingTransform['config']) => void
  move: (transform: MappingTransform, dx: number, dy: number) => void
  remove: (transform: MappingTransform) => void
  removeLink: (link: TransformLink, index: number) => void
}

const moveStep = 40

export function IssueList({ id, issues }: { id?: string; issues: ReadonlyArray<string> }) {
  const t = useTranslations('Mapping.transforms.issues')

  if (issues.length === 0) {
    return null
  }

  return (
    <div
      id={id}
      className="flex flex-col gap-1 rounded-md border border-dashed border-amber-700 px-3 py-2 text-sm dark:border-amber-300">
      <p className="flex items-center gap-1.5 font-medium">
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={2}
          aria-hidden
          className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
        />
        {t('heading')}
      </p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {issues.map((issue, index) => (
          <li key={`${index}:${issue}`} className="[overflow-wrap:anywhere]">
            {issue}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TransformDetails({
  transform,
  graph,
  issues,
  sourceFields,
  text,
  actions,
}: {
  transform: MappingTransform
  graph: Graph
  issues: ReadonlyArray<CanvasIssue>
  sourceFields: ReadonlyArray<SourceField>
  text: GraphText
  actions: TransformDetailsActions
}) {
  const t = useTranslations('Mapping.transforms')
  const tLinks = useTranslations('Mapping.links')
  const name = text.name(transform.id)
  const ports = transformPorts(transform)

  // The form shows its own fields' problems beside them.
  const shownInForm = formFields(transform.kind).map(({ name }) => name)

  const outgoing = graph.transformLinks.filter(
    ({ from }) => from.kind === 'transform' && from.transformId === transform.id,
  )

  const links = [
    ...ports.inputs.flatMap((input) => {
      const link = linkIntoInput(graph, transform.id, input)

      return link ? [link] : []
    }),
    ...outgoing,
  ]

  const removeButton = (link: TransformLink) => {
    const names = { source: text.start(link.from), target: text.end(link.to) }

    return (
      <Button
        size="sm"
        variant="outline"
        aria-label={tLinks('removeLabel', names)}
        data-remove-link
        onClick={() => actions.removeLink(link, links.indexOf(link))}>
        {tLinks('remove')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {text.kind(transform.kind)}
        </p>
        <h3 className="text-sm font-semibold">{name}</h3>
        <p className="text-muted-foreground text-sm">{t(`descriptions.${transform.kind}`)}</p>
      </div>
      <IssueList
        issues={issues
          .filter((issue) => !('field' in issue && shownInForm.includes(issue.field)))
          .map((issue) => text.issue(transform.kind, issue))}
      />
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide uppercase">{t('details.settings')}</h3>
        <TransformSettings
          key={transform.id}
          issues={issues}
          sourceFields={sourceFields}
          text={text}
          transform={transform}
          onConfigure={(config) => actions.configure(transform, config)}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide uppercase">{t('details.inputs')}</h3>
        {ports.inputs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('node.noInputs')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {ports.inputs.map((input) => {
              const link = linkIntoInput(graph, transform.id, input)

              return (
                <li
                  key={input}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">{text.input(input)}</span>
                    {': '}
                    <span className="font-mono">
                      {link ? text.start(link.from) : t('details.noLink')}
                    </span>
                  </span>
                  {link && removeButton(link)}
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide uppercase">{t('details.outputs')}</h3>
        <ul className="flex flex-col gap-1.5">
          {ports.outputs.map((output) => {
            const own = outgoing.filter(
              ({ from }) => from.kind === 'transform' && from.output === output,
            )

            return (
              <li key={output} className="flex flex-col gap-1 text-xs">
                <span className="font-medium">{text.output(output)}</span>
                {own.length === 0 ? (
                  <span className="text-muted-foreground">{t('details.noLink')}</span>
                ) : (
                  own.map((link) => (
                    <span
                      key={text.end(link.to)}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                        {text.end(link.to)}
                      </span>
                      {removeButton(link)}
                    </span>
                  ))
                )}
              </li>
            )
          })}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wide uppercase">{t('details.position')}</h3>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['moveLeft', ArrowLeft01Icon, -moveStep, 0],
              ['moveUp', ArrowUp01Icon, 0, -moveStep],
              ['moveDown', ArrowDown01Icon, 0, moveStep],
              ['moveRight', ArrowRight01Icon, moveStep, 0],
            ] as const
          ).map(([label, icon, dx, dy]) => (
            <Button
              key={label}
              size="icon-sm"
              variant="outline"
              aria-label={t(`details.${label}`, { name })}
              onClick={() => actions.move(transform, dx, dy)}>
              <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden />
            </Button>
          ))}
        </div>
      </section>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => actions.remove(transform)}>
        {t('details.removeLabel', { name })}
      </Button>
    </div>
  )
}
