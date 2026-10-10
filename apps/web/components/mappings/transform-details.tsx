'use client'

import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { TextField } from '@/components/form-field'
import {
  linkIntoInput,
  type Graph,
  isPlaceable,
  type PlaceableKind,
} from '@/components/mappings/mapping-graph'
import {
  decimalSeparators,
  draftTransformConfigSchemas,
  transformConfigIssues,
  transformPorts,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'

import type { GraphText } from '@/components/mappings/graph-text'
import type {
  MappingTransform,
  TransformConfigIssue,
  TransformIssue,
  TransformLink,
} from '@edi-bridge/contracts'

type FieldKind = 'text' | 'integer' | 'optionalInteger' | 'decimalSeparator'

const settingsFields = {
  constant: [['value', 'text']],
  concatenate: [
    ['inputCount', 'integer'],
    ['separator', 'text'],
  ],
  split: [
    ['separator', 'text'],
    ['index', 'integer'],
  ],
  substring: [
    ['start', 'integer'],
    ['length', 'optionalInteger'],
  ],
  dateFormat: [
    ['from', 'text'],
    ['to', 'text'],
  ],
  numberFormat: [
    ['decimalPlaces', 'optionalInteger'],
    ['decimalSeparator', 'decimalSeparator'],
  ],
} as const satisfies Record<PlaceableKind, ReadonlyArray<readonly [string, FieldKind]>>

type Values = Readonly<Record<string, string>>

type Candidate = Record<string, string | number | null>

function valuesOf(transform: MappingTransform & { kind: PlaceableKind }): Values {
  // SAFETY: every config is a flat object of strings, numbers and nulls, keyed by its field names.
  const config = transform.config as Readonly<Record<string, string | number | null>>

  return Object.fromEntries(
    settingsFields[transform.kind].map(([field]) => [field, String(config[field] ?? '')]),
  )
}

const wholeNumber = /^-?\d+$/

function read(kind: PlaceableKind, values: Values) {
  const candidate: Candidate = {}
  const local: TransformConfigIssue[] = []

  for (const [field, type] of settingsFields[kind]) {
    const value = values[field] ?? ''

    if (type === 'text' || type === 'decimalSeparator') {
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

function sameValues(kind: PlaceableKind, a: Values, b: Values) {
  return settingsFields[kind].every(([field]) => a[field] === b[field])
}

function TransformSettings({
  transform,
  text,
  onConfigure,
}: {
  transform: MappingTransform & { kind: PlaceableKind }
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

  const { issues } = read(transform.kind, values)

  const commit = (next: Values) => {
    const { config } = read(transform.kind, next)

    if (config && !sameValues(transform.kind, next, saved)) {
      setBase(next)
      onConfigure(config)
    }
  }

  const errorOf = (field: string) => {
    const issue = issues.find((found) => found.field === field)

    if (!issue) {
      return null
    }

    return issue.code === 'invalid' &&
      settingsFields[transform.kind].some(([name, type]) => name === field && type !== 'text')
      ? t('issues.notWholeNumber', { field: text.field(transform.kind, field) })
      : text.issue(transform.kind, issue)
  }

  return (
    <div className="flex flex-col gap-4">
      {settingsFields[transform.kind].map(([field, type]) => {
        const fieldId = `${id}${field}`
        const label = text.field(transform.kind, field)
        // SAFETY: `settingsFields` lists exactly the keys under `fieldDescriptions.<kind>`.
        const description = t(`fieldDescriptions.${transform.kind}.${field}` as never)

        if (type === 'decimalSeparator') {
          return (
            <div key={field} className="flex flex-col gap-1.5">
              <span id={`${fieldId}-label`} className="text-sm font-medium">
                {label}
              </span>
              <RadioGroup
                value={values[field] ?? null}
                aria-describedby={`${fieldId}-description`}
                aria-labelledby={`${fieldId}-label`}
                className="flex flex-col gap-2"
                onValueChange={(value) => {
                  const next = { ...values, [field]: String(value) }

                  setValues(next)
                  commit(next)
                }}>
                {decimalSeparators.map((separator) => (
                  <label key={separator} className="flex min-h-6 items-center gap-2 text-sm">
                    <RadioGroupItem value={separator} />
                    {t(separator === '.' ? 'separators.point' : 'separators.comma')}
                  </label>
                ))}
              </RadioGroup>
              <p id={`${fieldId}-description`} className="text-muted-foreground text-sm">
                {description}
              </p>
            </div>
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
            value={values[field] ?? ''}
            className={type === 'text' ? 'font-mono sm:max-w-sm' : 'font-mono sm:w-28'}
            onBlur={() => commit(values)}
            onChange={(value) => setValues({ ...values, [field]: value })}
            // Enter saves, as leaving the field does.
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(values)
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
  text,
  actions,
}: {
  transform: MappingTransform
  graph: Graph
  issues: ReadonlyArray<TransformIssue>
  text: GraphText
  actions: TransformDetailsActions
}) {
  const t = useTranslations('Mapping.transforms')
  const tLinks = useTranslations('Mapping.links')
  const name = text.name(transform.id)
  const ports = transformPorts(transform)

  // The form shows its own fields' problems beside them.
  const formFields: ReadonlyArray<string> = isPlaceable(transform.kind)
    ? settingsFields[transform.kind].map(([field]) => field)
    : []

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
          .filter((issue) => !('field' in issue && formFields.includes(issue.field)))
          .map((issue) => text.issue(transform.kind, issue))}
      />
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium tracking-wide uppercase">{t('details.settings')}</h3>
        {isPlaceable(transform.kind) ? (
          <TransformSettings
            key={transform.id}
            text={text}
            // SAFETY: `isPlaceable` just narrowed the kind of this very transform.
            transform={transform as MappingTransform & { kind: PlaceableKind }}
            onConfigure={(config) => actions.configure(transform, config)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t('details.settingsLater')}</p>
        )}
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
