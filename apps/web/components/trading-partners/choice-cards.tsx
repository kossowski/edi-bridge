'use client'

import { type ReactNode, useId } from 'react'

import { Badge } from '@edi-bridge/ui/components/badge'
import { Checkbox } from '@edi-bridge/ui/components/checkbox'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'
import { cn } from '@edi-bridge/ui/lib/utils'

type Choice<Value extends string> = {
  value: Value
  title: string
  description: string
  badge?: string | undefined
}

function ChoiceCard({
  descriptionId,
  item,
  control,
}: {
  descriptionId: string
  item: Choice<string>
  control: ReactNode
}) {
  return (
    <label className="has-data-checked:border-primary has-data-checked:bg-muted/50 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border p-3">
      {control}
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {item.title}
        {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
      </span>
      <span id={descriptionId} className="text-muted-foreground col-start-2 text-sm">
        {item.description}
      </span>
    </label>
  )
}

export function ChoiceCards<Value extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: Value | null
  items: ReadonlyArray<Choice<Value>>
  onChange: (value: Value) => void
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup
        value={value}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-2"
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        {items.map((item) => (
          <ChoiceCard
            key={item.value}
            control={
              <RadioGroupItem
                value={item.value}
                aria-describedby={`${id}-${item.value}`}
                className="mt-0.5"
              />
            }
            descriptionId={`${id}-${item.value}`}
            item={item}
          />
        ))}
      </RadioGroup>
    </div>
  )
}

export function CheckboxCards<Value extends string>({
  id,
  label,
  hideLabel = false,
  value,
  items,
  error = null,
  onChange,
}: {
  id: string
  label: string
  hideLabel?: boolean
  value: ReadonlyArray<Value>
  items: ReadonlyArray<Choice<Value>>
  error?: string | null
  onChange: (value: Value, checked: boolean) => void
}) {
  return (
    <fieldset
      id={id}
      aria-describedby={error ? `${id}-error` : undefined}
      className="flex min-w-0 flex-col gap-2">
      <legend className={cn('mb-2 text-sm font-medium', hideLabel && 'sr-only')}>{label}</legend>
      {items.map((item) => (
        <ChoiceCard
          key={item.value}
          control={
            <Checkbox
              checked={value.includes(item.value)}
              aria-describedby={`${id}-${item.value}`}
              className="mt-0.5"
              onCheckedChange={(checked) => onChange(item.value, checked)}
            />
          }
          descriptionId={`${id}-${item.value}`}
          item={item}
        />
      ))}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </fieldset>
  )
}
