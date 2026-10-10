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
import { type ComponentType, useEffect, useId, useRef, useState } from 'react'

import { RadioField, SelectField, TextareaField, TextField } from '@/components/form-field'
import {
  insertText,
  jsonataPath,
  knownSyntaxError,
  textPosition,
} from '@/components/mappings/expression-text'
import { type CanvasIssue, linkIntoInput, type Graph } from '@/components/mappings/mapping-graph'
import {
  type FieldInput,
  type FormFieldSpec,
  formFields,
  type FormValues,
} from '@/components/mappings/transform-kinds'
import { lookupTablesQuery } from '@/lib/api/queries'
import {
  conditionOperators,
  decimalSeparators,
  draftTransformConfigSchemas,
  expressionSyntaxError,
  lookupFallbacks,
  transformConfigIssues,
  transformPorts,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

import type { GraphText } from '@/components/mappings/graph-text'
import type {
  ExpressionSyntaxError,
  LookupTableSummary,
  MappingTransform,
  TransformConfigIssue,
  TransformLink,
} from '@edi-bridge/contracts'

export type SourceField = { path: string; label: string }

type Candidate = Record<string, string | number | null>

type FormIssue = TransformConfigIssue | { field: string; code: 'notWholeNumber' }

type ReadValue = { value: string | number | null; code?: 'required' | 'notWholeNumber' }

type Choice = { value: string; label: string }

type WidgetProps = {
  id: string
  label: string
  description: string
  value: string
  saved: string
  error: string | null
  sourceFields: ReadonlyArray<SourceField>
  // Sets the field without saving, as while typing.
  onChange: (value: string) => void
  // Sets the field and saves the form if it is valid.
  onCommit: (value: string) => void
}

type InputKind = { read: (value: string) => ReadValue; Widget: ComponentType<WidgetProps> }

function valuesOf(transform: MappingTransform): FormValues {
  // SAFETY: every config is a flat object of strings, numbers and nulls, keyed by its field names.
  const config = transform.config as Readonly<Record<string, string | number | null>>

  return Object.fromEntries(
    formFields(transform.kind).map(({ name }) => [name, String(config[name] ?? '')]),
  )
}

const wholeNumber = /^-?\d+$/

const asText = (value: string): ReadValue => ({ value })

function asInteger(required: boolean) {
  return (value: string): ReadValue => {
    const trimmed = value.trim()

    if (trimmed === '') {
      return required ? { value: null, code: 'required' } : { value: null }
    }

    return wholeNumber.test(trimmed)
      ? { value: Number(trimmed) }
      : { value, code: 'notWholeNumber' }
  }
}

function TextInput({
  id,
  label,
  description,
  value,
  saved,
  error,
  onChange,
  onCommit,
  numeric,
}: WidgetProps & { numeric: boolean }) {
  return (
    <TextField
      id={id}
      autoComplete="off"
      description={description}
      error={error}
      inputMode={numeric ? 'numeric' : undefined}
      label={label}
      spellCheck={false}
      value={value}
      className={numeric ? 'font-mono sm:w-28' : 'font-mono sm:max-w-sm'}
      onBlur={() => onCommit(value)}
      onChange={onChange}
      // Enter saves, as leaving the field does.
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit(value)
        }
      }}
      // The canvas clears the selection on Escape; caught before it, the first Escape only takes
      // back what was typed, so the form and the focus stay.
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && value !== saved) {
          event.preventDefault()
          onChange(saved)
        }
      }}
    />
  )
}

function PlainTextInput(props: WidgetProps) {
  return <TextInput {...props} numeric={false} />
}

function NumberInput(props: WidgetProps) {
  return <TextInput {...props} numeric />
}

function radioInput(useChoices: () => ReadonlyArray<Choice>): ComponentType<WidgetProps> {
  return function ChoiceInput({ id, label, description, value, onCommit }: WidgetProps) {
    return (
      <RadioField
        id={id}
        description={description}
        items={useChoices()}
        label={label}
        value={value}
        onChange={onCommit}
      />
    )
  }
}

function useSeparators() {
  const t = useTranslations('Mapping.transforms.separators')

  return decimalSeparators.map((value) => ({
    value,
    label: t(value === '.' ? 'point' : 'comma'),
  }))
}

function useFallbacks() {
  const t = useTranslations('Mapping.transforms.fallbacks')

  return lookupFallbacks.map((value) => ({ value, label: t(value) }))
}

function useOperators() {
  const t = useTranslations('Mapping.transforms.operatorNames')

  return conditionOperators.map((value) => ({ value, label: t(value) }))
}

function useScopeText() {
  const t = useTranslations('Mapping.transforms.lookupTables')

  return ({ scope }: LookupTableSummary) =>
    scope.kind === 'workspace'
      ? t('workspace')
      : t('tradingPartner', { name: scope.tradingPartner.name })
}

function LookupTableInput({ id, label, description, value, error, onCommit }: WidgetProps) {
  const t = useTranslations('Mapping.transforms.lookupTables')
  const scopeOf = useScopeText()
  const tables = useQuery(lookupTablesQuery)
  const chosen = tables.data?.find((table) => table.id === value)
  const loading = tables.isPending
  const statusId = `${id}-status`

  const items = (tables.data ?? []).map((table) => ({
    value: table.id,
    label: table.name,
    detail: scopeOf(table),
  }))

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
      <SelectField
        id={id}
        describedBy={statusId}
        description={description}
        disabled={tables.isError || (tables.isSuccess && items.length === 0)}
        error={error}
        items={items}
        label={label}
        loading={loading}
        placeholder={loading ? t('loading') : t('placeholder')}
        value={value}
        className=""
        onChange={onCommit}
      />
      <div id={statusId} aria-live="polite">
        {status()}
      </div>
    </div>
  )
}

function useSyntaxErrorText() {
  const t = useTranslations('Mapping.transforms.expression')

  return (error: ExpressionSyntaxError) => {
    const code = knownSyntaxError(error.code)

    return code
      ? t(`syntaxErrors.${code}`, { token: error.token ?? '', value: error.value ?? '' })
      : error.message
  }
}

function ExpressionInput({
  id,
  label,
  description,
  value,
  saved,
  error: required,
  sourceFields,
  onChange,
  onCommit,
}: WidgetProps) {
  const t = useTranslations('Mapping.transforms.expression')
  const syntaxText = useSyntaxErrorText()
  const editor = useRef<HTMLTextAreaElement>(null)
  const selection = useRef<[number, number] | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const syntax = value.trim() === '' ? null : expressionSyntaxError(value)
  const at = syntax && textPosition(value, syntax.position)

  const pathItems = sourceFields.map((field) => ({
    value: field.path,
    label: field.path,
    ...(field.label !== field.path && { detail: field.label }),
  }))

  // The parser says more than the contract's "not a valid expression".
  const error = at
    ? t('syntaxError', { line: at.line, column: at.column, message: syntaxText(syntax) })
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
    onCommit(next.value)
    pendingCaret.current = { offset: next.caret, value: next.value }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <TextareaField
        id={id}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        description={description}
        error={error}
        label={label}
        ref={editor}
        rows={5}
        spellCheck={false}
        value={value}
        className="min-h-28 font-mono text-sm md:text-sm"
        onBlur={() => {
          remember()
          onCommit(value)
        }}
        onChange={onChange}
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
      {error ? (
        at && (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => focusAt(at.offset)}>
            {t('goToError')}
          </Button>
        )
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
      <div className="flex flex-col items-start gap-2 pt-1">
        <SelectField
          id={`${id}-path`}
          description={t('sourcePathDescription')}
          disabled={pathItems.length === 0}
          items={pathItems}
          label={t('sourcePath')}
          mono
          placeholder={t('sourcePathPlaceholder')}
          value={path}
          className=""
          onChange={setPath}
        />
        <Button disabled={path === null} size="sm" variant="outline" onClick={insert}>
          {t('insert')}
        </Button>
      </div>
    </div>
  )
}

const inputKinds: Readonly<Record<FieldInput, InputKind>> = {
  text: { read: asText, Widget: PlainTextInput },
  integer: { read: asInteger(true), Widget: NumberInput },
  optionalInteger: { read: asInteger(false), Widget: NumberInput },
  decimalSeparator: { read: asText, Widget: radioInput(useSeparators) },
  lookupTable: {
    read: (value) => ({ value: value === '' ? null : value }),
    Widget: LookupTableInput,
  },
  fallback: { read: asText, Widget: radioInput(useFallbacks) },
  operator: { read: asText, Widget: radioInput(useOperators) },
  expression: { read: asText, Widget: ExpressionInput },
}

function read(kind: MappingTransform['kind'], values: FormValues) {
  const candidate: Candidate = {}
  const local: FormIssue[] = []

  for (const { name, input } of formFields(kind)) {
    const { value, code } = inputKinds[input].read(values[name] ?? '')

    candidate[name] = value

    if (code) {
      local.push({ field: name, code })
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

function sameValues(kind: MappingTransform['kind'], a: FormValues, b: FormValues) {
  return formFields(kind).every(({ name }) => a[name] === b[name])
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

  const commit = (next: FormValues) => {
    const { config } = read(transform.kind, next)

    if (config && !sameValues(transform.kind, next, saved)) {
      setBase(next)
      onConfigure(config)
    }
  }

  const errorOf = ({ name, canvasIssues = [] }: FormFieldSpec) => {
    const fromCanvas =
      values[name] === saved[name]
        ? issues.find(
            (issue) =>
              'field' in issue &&
              issue.field === name &&
              canvasIssues.some((code) => code === issue.code),
          )
        : undefined

    if (fromCanvas) {
      return text.issue(transform.kind, fromCanvas)
    }

    const issue = formIssues.find((found) => found.field === name)

    if (!issue) {
      return null
    }

    return issue.code === 'notWholeNumber'
      ? t('issues.notWholeNumber', { field: text.field(transform.kind, name) })
      : text.issue(transform.kind, issue)
  }

  const shown = formFields(transform.kind).filter(
    ({ visibleWhen }) => visibleWhen?.(values) ?? true,
  )

  return (
    <div className="flex flex-col gap-4">
      {shown.map((field) => {
        const { Widget } = inputKinds[field.input]

        return (
          <Widget
            key={field.name}
            id={`${id}${field.name}`}
            // SAFETY: the form fields are exactly the keys under `fieldDescriptions.<kind>`.
            description={t(`fieldDescriptions.${transform.kind}.${field.name}` as never)}
            error={errorOf(field)}
            label={text.field(transform.kind, field.name)}
            saved={saved[field.name] ?? ''}
            sourceFields={sourceFields}
            value={values[field.name] ?? ''}
            onChange={(next) => setValues({ ...values, [field.name]: next })}
            onCommit={(next) => {
              const nextValues = { ...values, [field.name]: next }

              setValues(nextValues)
              commit(nextValues)
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
