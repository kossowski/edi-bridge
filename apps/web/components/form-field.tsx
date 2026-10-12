'use client'

import { ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type ComponentProps, type ReactNode, useState } from 'react'

import { Input } from '@edi-bridge/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@edi-bridge/ui/components/input-group'
import { RadioGroup, RadioGroupItem } from '@edi-bridge/ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
import { Textarea } from '@edi-bridge/ui/components/textarea'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { GlnError } from '@/lib/forms/gln'

export function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string
  label: ReactNode
  description?: string | undefined
  error: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {children}
      {description !== undefined && (
        <p id={`${id}-description`} className="text-muted-foreground text-sm">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

export function describedBy(id: string, error: string | null, hasDescription = true) {
  return [hasDescription && `${id}-description`, error && `${id}-error`].filter(Boolean).join(' ')
}

type FieldProps = {
  id: string
  label: string
  description: string
  error: string | null
  value: string
  onChange: (value: string) => void
}

function LabelledField({
  id,
  label,
  description,
  error,
  children,
}: Omit<FieldProps, 'value' | 'onChange' | 'description'> & {
  description?: string | undefined
  children: ReactNode
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      }>
      {children}
    </FormField>
  )
}

export function TextField({
  id,
  label,
  description,
  error,
  value,
  onChange,
  ...inputProps
}: Omit<FieldProps, 'description'> & {
  description?: string | undefined
} & Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange'>) {
  return (
    <LabelledField id={id} description={description} error={error} label={label}>
      <Input
        id={id}
        value={value}
        aria-describedby={describedBy(id, error, description !== undefined) || undefined}
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
    </LabelledField>
  )
}

export function PasswordField({
  id,
  label,
  description,
  error,
  value,
  onChange,
  ...inputProps
}: Omit<FieldProps, 'description'> & {
  description?: string | undefined
} & Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange' | 'type'>) {
  const t = useTranslations('PasswordField')
  const [visible, setVisible] = useState(false)

  return (
    <LabelledField id={id} description={description} error={error} label={label}>
      <InputGroup>
        <InputGroupInput
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          aria-describedby={describedBy(id, error, description !== undefined) || undefined}
          aria-invalid={error !== null}
          onChange={(event) => onChange(event.target.value)}
          {...inputProps}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-controls={id}
            aria-label={visible ? t('hide') : t('show')}
            onClick={() => setVisible((current) => !current)}>
            <HugeiconsIcon icon={visible ? ViewOffIcon : ViewIcon} strokeWidth={2} />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </LabelledField>
  )
}

export function TextareaField({
  id,
  label,
  description,
  error,
  value,
  onChange,
  ...textareaProps
}: FieldProps & Omit<ComponentProps<'textarea'>, 'id' | 'value' | 'onChange'>) {
  return (
    <LabelledField id={id} description={description} error={error} label={label}>
      <Textarea
        id={id}
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-invalid={error !== null}
        onChange={(event) => onChange(event.target.value)}
        {...textareaProps}
      />
    </LabelledField>
  )
}

type Choice<Value extends string> = { value: Value; label: string; detail?: string }

function OwnLabel({ id, label }: { id: string; label: string }) {
  return (
    <span id={`${id}-label`} className="text-sm font-medium">
      {label}
    </span>
  )
}

export function SelectField<Value extends string>({
  id,
  label,
  description,
  value,
  items,
  onChange,
  placeholder,
  error = null,
  disabled = false,
  loading = false,
  mono = false,
  describedBy: alsoDescribedBy,
  className = 'sm:w-80',
}: {
  id: string
  label: string
  description: string
  value: Value | null
  items: ReadonlyArray<Choice<Value>>
  onChange: (value: Value) => void
  placeholder?: string
  error?: string | null
  disabled?: boolean
  loading?: boolean
  mono?: boolean
  describedBy?: string
  className?: string
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={<OwnLabel id={id} label={label} />}>
      <Select
        disabled={disabled}
        items={items}
        // Until its items load, Base UI would show the raw value, e.g. an ID.
        value={items.some((item) => item.value === value) ? value : null}
        // Unlike disabled, loading keeps the trigger focusable, so a dialog can focus it on open.
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
          aria-describedby={[describedBy(id, error), alsoDescribedBy].filter(Boolean).join(' ')}
          aria-disabled={loading || undefined}
          aria-invalid={error !== null}
          aria-labelledby={`${id}-label`}
          className={cn(
            'w-full aria-disabled:cursor-progress aria-disabled:opacity-50',
            mono && 'font-mono',
            className,
          )}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} label={item.label} value={item.value}>
              {item.detail === undefined ? (
                <span className={cn(mono && 'font-mono')}>{item.label}</span>
              ) : (
                <span className="flex min-w-0 flex-col">
                  <span className={cn('truncate', mono && 'font-mono')}>{item.label}</span>
                  <span className="text-muted-foreground truncate text-xs">{item.detail}</span>
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function RadioField<Value extends string>({
  id,
  label,
  description,
  value,
  items,
  onChange,
  error = null,
}: {
  id: string
  label: string
  description: string
  value: Value | null
  items: ReadonlyArray<Choice<Value>>
  onChange: (value: Value) => void
  error?: string | null
}) {
  return (
    <FormField
      id={id}
      description={description}
      error={error}
      label={<OwnLabel id={id} label={label} />}>
      <RadioGroup
        value={value}
        aria-describedby={describedBy(id, error)}
        aria-labelledby={`${id}-label`}
        className="flex flex-col gap-2"
        onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)

          if (item) {
            onChange(item.value)
          }
        }}>
        {items.map((item) => (
          <div key={item.value} className="flex flex-col">
            <label className="flex min-h-6 items-center gap-2 text-sm">
              <RadioGroupItem
                value={item.value}
                aria-describedby={item.detail === undefined ? undefined : `${id}-${item.value}`}
              />
              {item.label}
            </label>
            {item.detail !== undefined && (
              <p id={`${id}-${item.value}`} className="text-muted-foreground pl-6 text-sm">
                {item.detail}
              </p>
            )}
          </div>
        ))}
      </RadioGroup>
    </FormField>
  )
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-6 border-t pt-4">
      <legend className="pr-2 font-semibold">{legend}</legend>
      {children}
    </fieldset>
  )
}

export function useGlnErrorMessage() {
  const t = useTranslations('GlnField.errors')

  return (error: GlnError) => t(error)
}

export function GlnField(props: FieldProps) {
  return (
    <TextField
      {...props}
      autoComplete="off"
      inputMode="numeric"
      name="gln"
      spellCheck={false}
      className="font-mono sm:w-60"
    />
  )
}
