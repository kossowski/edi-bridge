'use client'

import { useId } from 'react'

import { Badge } from '@edi-bridge/ui/components/badge'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'

type Choice<Value extends string> = {
  value: Value
  title: string
  description: string
  badge?: string | undefined
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
          <label
            key={item.value}
            className="has-data-checked:border-primary has-data-checked:bg-muted/50 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border p-3">
            <RadioGroupItem
              value={item.value}
              aria-describedby={`${id}-${item.value}`}
              className="mt-0.5"
            />
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {item.title}
              {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
            </span>
            <span id={`${id}-${item.value}`} className="text-muted-foreground col-start-2 text-sm">
              {item.description}
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}
